// js/simulator.js
(() => {
    const MAX_ALTITUDE = 18.0; // 防作弊限高 18m

    let scene, camera, renderer, droneGroup, rainSystem;
    let staticObstacles = [];
    let dynamicObstacles = [];
    let obstacleGroup;

    const roofConfig = {
        baseHeight: 8.0,
        pad: { x: 5.2, z: -138.0 },
        tower1: { x: 0.5, z: -132.5 },
        tower2: { x: 9.0, z: -143.0 }
    };

    let currentLevel = 1;
    let isRunning = false;
    let isBadWeather = false;
    let studentController = null;
    let demoController = null;
    const sensors = new window.SensorSuite();

    const droneState = {
        position: { x: 0, y: 8.5, z: 0 },
        velocity: { vx: 0, vy: 0, vz: 0 }
    };

    function initThree() {
        const container = document.getElementById('canvasContainer');
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0b1528);
        scene.fog = new THREE.FogExp2(0x0b1528, 0.005);

        camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 300);
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 0.85));
        const dirLight = new THREE.DirectionalLight(0x38bdf8, 1.1);
        dirLight.position.set(25, 50, 30);
        scene.add(dirLight);

        const grid = new THREE.GridHelper(220, 80, 0x00A59B, 0x1e293b);
        grid.position.set(0, 0, -80);
        scene.add(grid);

        // 18m 限高防護雷射網格
        const ceilingGeo = new THREE.PlaneGeometry(36, 190, 12, 40);
        const ceilingMat = new THREE.MeshBasicMaterial({
            color: 0xef4444,
            wireframe: true,
            transparent: true,
            opacity: 0.28
        });
        const ceilingMesh = new THREE.Mesh(ceilingGeo, ceilingMat);
        ceilingMesh.rotation.x = Math.PI / 2;
        ceilingMesh.position.set(0, MAX_ALTITUDE, -80);
        scene.add(ceilingMesh);

        // 建立四軸物流無人機
        droneGroup = new THREE.Group();
        const bodyGeo = new THREE.BoxGeometry(1.4, 0.45, 1.4);
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x0076CE,
            emissive: 0x005BAC,
            emissiveIntensity: 0.45,
            metalness: 0.5,
            roughness: 0.2
        });
        droneGroup.add(new THREE.Mesh(bodyGeo, bodyMat));

        const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.2);
        const armMat = new THREE.MeshBasicMaterial({ color: 0xC4B5FD });
        const arm1 = new THREE.Mesh(armGeo, armMat);
        arm1.rotation.z = Math.PI / 2;
        arm1.rotation.y = Math.PI / 4;
        const arm2 = arm1.clone();
        arm2.rotation.y = -Math.PI / 4;
        droneGroup.add(arm1, arm2);
        scene.add(droneGroup);

        // 雨霧粒子系統
        const rainGeo = new THREE.BufferGeometry();
        const rainPositions = new Float32Array(1200 * 3);
        for (let i = 0; i < 1200; i++) {
            rainPositions[i * 3] = (Math.random() - 0.5) * 50;
            rainPositions[i * 3 + 1] = Math.random() * 25;
            rainPositions[i * 3 + 2] = -Math.random() * 165;
        }
        rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
        rainSystem = new THREE.Points(
            rainGeo,
            new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.2, transparent: true, opacity: 0.75 })
        );
        rainSystem.visible = false;
        scene.add(rainSystem);

        obstacleGroup = new THREE.Group();
        scene.add(obstacleGroup);

        window.addEventListener('resize', () => {
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
        });
    }

    function buildLevelScene(level) {
        while (obstacleGroup.children.length > 0) {
            obstacleGroup.remove(obstacleGroup.children[0]);
        }
        staticObstacles = [];
        dynamicObstacles = [];

        // 關卡 1 & 4：高壓細電線與靜止垂直柱體
        if (level === 1 || level === 4) {
            const wireMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
            const wireConfigs = [
                { z: -28, y: 8.5 },
                { z: -48, y: 11.2 },
                { z: -68, y: 6.2 },
                { z: -88, y: 9.2 }
            ];
            wireConfigs.forEach(w => {
                const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 28), wireMat);
                mesh.rotation.z = Math.PI / 2;
                mesh.position.set(0, w.y, w.z);
                obstacleGroup.add(mesh);
                staticObstacles.push({ x: 0, y: w.y, z: w.z, hx: 14.0, hy: 0.85, hz: 0.4 });
            });

            const poleConfigs = [
                { x: -3.2, z: -38 },
                { x: 3.2, z: -58 },
                { x: -1.2, z: -78 },
                { x: 3.5, z: -102 }
            ];
            const poleMat = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.4 });
            poleConfigs.forEach(p => {
                const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 18), poleMat);
                mesh.position.set(p.x, 9, p.z);
                obstacleGroup.add(mesh);
                staticObstacles.push({ x: p.x, y: 9, z: p.z, hx: 0.9, hy: 9.0, hz: 0.9 });
            });
        }

        // 關卡 2 & 4：橫向移動動態飛鳥與巡邏機
        if (level === 2 || level === 4) {
            const dynConfigs = [
                { id: 1, z: -36, y: 8.5, x: -7, vx: 6.2, color: 0x00A59B },
                { id: 2, z: -64, y: 9.2, x: 7, vx: -6.8, color: 0xa78bfa },
                { id: 3, z: -92, y: 8.8, x: -5, vx: 7.4, color: 0x00A59B },
                { id: 4, z: -114, y: 9.5, x: 6, vx: -6.0, color: 0xa78bfa }
            ];
            dynConfigs.forEach(d => {
                const mesh = new THREE.Mesh(
                    new THREE.SphereGeometry(1.2, 16, 16),
                    new THREE.MeshStandardMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.5 })
                );
                mesh.position.set(d.x, d.y, d.z);
                obstacleGroup.add(mesh);
                dynamicObstacles.push({ id: d.id, mesh, vx: d.vx, vy: 0, vz: 0, radius: 1.2 });
            });
        }

        // 關卡 3 & 4：終點大樓屋頂、斜坡、水塔與停機坪
        if (level === 3 || level === 4) {
            const building = new THREE.Mesh(
                new THREE.BoxGeometry(26, 8, 26),
                new THREE.MeshStandardMaterial({ color: 0x1e293b })
            );
            building.position.set(0, 4, -138);
            obstacleGroup.add(building);

            const slopeMesh = new THREE.Mesh(
                new THREE.BoxGeometry(11, 0.6, 24),
                new THREE.MeshStandardMaterial({ color: 0x991b1b })
            );
            slopeMesh.position.set(-6.8, 9.4, -138);
            slopeMesh.rotation.z = -0.32;
            obstacleGroup.add(slopeMesh);

            const towerMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.6 });
            [roofConfig.tower1, roofConfig.tower2].forEach(t => {
                const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 3.6, 20), towerMat);
                tower.position.set(t.x, 9.8, t.z);
                obstacleGroup.add(tower);
            });

            const padMesh = new THREE.Mesh(
                new THREE.CylinderGeometry(2.7, 2.7, 0.25, 28),
                new THREE.MeshBasicMaterial({ color: 0x00A59B })
            );
            padMesh.position.set(roofConfig.pad.x, 8.15, roofConfig.pad.z);
            obstacleGroup.add(padMesh);
        }

        // 關卡 5：高樓峽谷走廊與交錯凸出牆體
        if (level === 5) {
            const wallMat = new THREE.MeshStandardMaterial({ color: 0x334155, transparent: true, opacity: 0.85 });
            const leftWall = new THREE.Mesh(new THREE.BoxGeometry(2, 16, 140), wallMat);
            leftWall.position.set(-7.5, 8, -70);
            const rightWall = new THREE.Mesh(new THREE.BoxGeometry(2, 16, 140), wallMat);
            rightWall.position.set(7.5, 8, -70);
            obstacleGroup.add(leftWall, rightWall);

            staticObstacles.push({ x: -7.5, y: 8, z: -70, hx: 1.0, hy: 8.0, hz: 70.0 });
            staticObstacles.push({ x: 7.5, y: 8, z: -70, hx: 1.0, hy: 8.0, hz: 70.0 });

            // 巷弄內交錯障礙物
            const blocks = [
                { x: -2.8, z: -42 },
                { x: 2.8, z: -76 },
                { x: -2.2, z: -108 }
            ];
            const blockMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b });
            blocks.forEach(b => {
                const m = new THREE.Mesh(new THREE.BoxGeometry(3.2, 14, 3.2), blockMat);
                m.position.set(b.x, 7, b.z);
                obstacleGroup.add(m);
                staticObstacles.push({ x: b.x, y: 7, z: b.z, hx: 1.6, hy: 7.0, hz: 1.6 });
            });
        }

        // 關卡 6：單眼光流運動視差柱陣
        if (level === 6) {
            const flowPoles = [
                { x: 0.4, z: -32 },
                { x: -2.2, z: -56 },
                { x: 2.4, z: -80 },
                { x: -0.5, z: -105 }
            ];
            const flowMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.3 });
            flowPoles.forEach(p => {
                const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 16, 20), flowMat);
                mesh.position.set(p.x, 8, p.z);
                obstacleGroup.add(mesh);
                staticObstacles.push({ x: p.x, y: 8, z: p.z, hx: 1.1, hy: 8.0, hz: 1.1 });
            });
        }

        // 關卡 1, 2, 5, 6 終點線 (Z = -135m)
        if (level !== 3 && level !== 4) {
            const goalMesh = new THREE.Mesh(
                new THREE.BoxGeometry(24, 0.4, 1.2),
                new THREE.MeshBasicMaterial({ color: 0x00A59B })
            );
            goalMesh.position.set(0, 0.2, -135);
            obstacleGroup.add(goalMesh);
        }
    }

    function selectLevel(level) {
        currentLevel = Number(level);
        if (!window.LEVEL_DATA[currentLevel]) currentLevel = 1;
        isRunning = false;

        document.querySelectorAll('.level-btn').forEach(btn => {
            const active = Number(btn.dataset.level) === currentLevel;
            btn.className = active
                ? 'level-btn px-3 py-1.5 rounded-xl text-sm font-black btn-fubon-aqua transition shadow-sm'
                : 'level-btn px-3 py-1.5 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-300 transition';
        });

        const info = window.LEVEL_DATA[currentLevel];
        document.getElementById('missionTitle').textContent = info.title;
        document.getElementById('missionBadge').textContent = info.badge;
        document.getElementById('missionDesc').textContent = info.desc;

        setWeather(currentLevel === 2);
        loadTodoOnly();
        resetDrone();
        buildLevelScene(currentLevel);
    }

    function loadTodoOnly() {
        const info = window.LEVEL_DATA[currentLevel];
        document.getElementById('codeEditor').value = info.todo;
    }

    function setWeather(bad) {
        isBadWeather = bad;
        const btn = document.getElementById('btnWeather');
        if (isBadWeather) {
            btn.textContent = '🌧️ 濃霧豪雨 (光學退化)';
            btn.className = 'px-4 py-2 rounded-2xl text-sm font-bold badge-lavender transition';
            scene.fog.density = 0.026;
            rainSystem.visible = true;
        } else {
            btn.textContent = '☀️ 晴朗無霧';
            btn.className = 'px-4 py-2 rounded-2xl text-sm font-bold bg-blue-50 text-[#005BAC] border-2 border-blue-200 hover:bg-blue-100 transition';
            scene.fog.density = 0.005;
            rainSystem.visible = false;
        }
    }

    function resetDrone() {
        isRunning = false;
        droneState.position = {
            x: 0,
            y: (currentLevel === 3 ? 13.5 : 8.5),
            z: 0
        };
        droneState.velocity = { vx: 0, vy: 0, vz: 0 };
        updateDroneMesh();
        setStatus('🟢 已重置無人機位置。修改 【TODO】 參數後點擊「▶ 執行學生程式」，或點「🚀 一鍵自動演示」。', 'normal');
        document.getElementById('flightStateBadge').textContent = 'STANDBY';
    }

    function compileAndRunStudent() {
        const code = document.getElementById('codeEditor').value;
        try {
            const CustomClass = new Function(`${code}; return StudentController;`)();
            studentController = new CustomClass();
            demoController = null;
            resetDrone();
            isRunning = true;
            document.getElementById('flightStateBadge').textContent = 'STUDENT CODE';
            setStatus('🚀 學生程式執行中...', 'running');
        } catch (err) {
            setStatus(`❌ 語法錯誤：${err.message}`, 'error');
        }
    }

    function compileAndRunDemo() {
        const info = window.LEVEL_DATA[currentLevel];
        try {
            const DemoClass = new Function(`${info.solution}; return StudentController;`)();
            demoController = new DemoClass();
            studentController = null;
            resetDrone();
            isRunning = true;
            document.getElementById('flightStateBadge').textContent = 'AUTO-DEMO';
            setStatus('🚀【自動演示模式】標準解答於背景運行中（編輯器維持學生 TODO 練習畫面）', 'success');
        } catch (err) {
            setStatus(`❌ 演示載入錯誤：${err.message}`, 'error');
        }
    }

    function setStatus(msg, type) {
        const el = document.getElementById('statusText');
        el.textContent = msg;
        el.className = type === 'error'
            ? 'text-red-600 font-extrabold'
            : type === 'success'
            ? 'text-[#00897B] font-black'
            : 'text-slate-900';
    }

    function updateDroneMesh() {
        droneGroup.position.set(droneState.position.x, droneState.position.y, droneState.position.z);
        droneGroup.rotation.z = -droneState.velocity.vx * 0.035;
        droneGroup.rotation.x = droneState.velocity.vz * 0.025;

        camera.position.set(
            droneState.position.x * 0.5,
            droneState.position.y + 4.2,
            droneState.position.z + 13.5
        );
        camera.lookAt(droneState.position.x, droneState.position.y, droneState.position.z - 15);

        document.getElementById('telX').textContent = `${droneState.position.x.toFixed(1)}m`;
        document.getElementById('telY').textContent = `${droneState.position.y.toFixed(1)}m`;
        document.getElementById('telZ').textContent = `${droneState.position.z.toFixed(1)}m`;

        const altPct = Math.min(100, Math.max(0, Math.round((droneState.position.y / MAX_ALTITUDE) * 100)));
        document.getElementById('altPercentText').textContent = `${altPct}%`;
        const altBar = document.getElementById('altBar');
        altBar.style.width = `${altPct}%`;

        const telPanel = document.getElementById('telemetryPanel');
        if (droneState.position.y > 15.0) {
            altBar.className = 'h-full bg-red-500 transition-all duration-100';
            telPanel.classList.add('altitude-warning-active');
        } else {
            altBar.className = 'h-full bg-gradient-to-r from-[#005BAC] to-[#00897B] transition-all duration-100';
            telPanel.classList.remove('altitude-warning-active');
        }
    }

    let lastTime = performance.now();
    function animate(now) {
        requestAnimationFrame(animate);
        const dt = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        for (let dyn of dynamicObstacles) {
            dyn.mesh.position.x += dyn.vx * dt;
            if (Math.abs(dyn.mesh.position.x) > 12.5) {
                dyn.vx *= -1;
            }
        }

        const depthMap = sensors.computeStereoDepthMap(droneState.position, staticObstacles, dynamicObstacles, isBadWeather, currentLevel);
        const radarList = sensors.compute4DRadarDetections(droneState.position, droneState.velocity, dynamicObstacles, currentLevel);
        const tofData = sensors.computeDownwardToF(droneState.position, roofConfig);
        const lidarScan = sensors.computeLidarScan(droneState.position, staticObstacles, dynamicObstacles);
        const proxData = sensors.computeProximity(droneState.position, staticObstacles);
        const flowData = sensors.computeOpticalFlow(droneState.position, droneState.velocity, staticObstacles);
        sensors.renderHUDs(currentLevel);

        if (isRunning) {
            const activeController = demoController || studentController;
            if (activeController) {
                const api = {
                    get_stereo_depth_map: () => depthMap,
                    get_4d_radar_detections: () => radarList,
                    get_downward_tof: () => tofData,
                    get_lidar_scan: () => lidarScan,
                    get_proximity: () => proxData,
                    get_optical_flow: () => flowData,
                    get_stereo_quality: () => sensors.stereoQuality,
                    set_debug_window: (r, c) => { sensors.debugWindow = { r, c }; }
                };

                try {
                    const cmd = activeController.get_velocity(
                        { level: currentLevel, position: { ...droneState.position }, velocity: { ...droneState.velocity } },
                        api
                    ) || { vx: 0, vy: 0, vz: 0 };

                    // L5 加入模擬峽谷側風干擾
                    const windVx = (currentLevel === 5) ? Math.sin(droneState.position.z * 0.08) * 2.8 : 0;

                    droneState.velocity.vx = Math.max(-12, Math.min(12, (Number(cmd.vx) || 0) + windVx));
                    droneState.velocity.vy = Math.max(-6, Math.min(6, Number(cmd.vy) || 0));
                    droneState.velocity.vz = Math.max(-14, Math.min(5, Number(cmd.vz) || 0));
                } catch (e) {
                    isRunning = false;
                    setStatus(`❌ 執行期錯誤：${e.message}`, 'error');
                }
            }

            droneState.position.x += droneState.velocity.vx * dt;
            droneState.position.y += droneState.velocity.vy * dt;
            droneState.position.z += droneState.velocity.vz * dt;
            updateDroneMesh();

            checkCollisionsAndGoals(tofData);
        }

        renderer.render(scene, camera);
    }

    function checkCollisionsAndGoals(tofData) {
        const p = droneState.position;

        if (p.y >= MAX_ALTITUDE) {
            isRunning = false;
            document.getElementById('flightStateBadge').textContent = 'ALT VIOLATION';
            setStatus('🚨 觸發 18.0m 防作弊雷射限高網格！請在走廊高度內避障。', 'error');
            return;
        }

        for (let obs of staticObstacles) {
            if (Math.abs(p.x - obs.x) < obs.hx + 0.50 &&
                Math.abs(p.y - obs.y) < obs.hy + 0.40 &&
                Math.abs(p.z - obs.z) < obs.hz + 0.50) {
                isRunning = false;
                document.getElementById('flightStateBadge').textContent = 'CRASHED';
                setStatus(`💥 發生碰撞！請依本關提示調整 【TODO】 避障參數，或點擊「一鍵自動演示」觀摩。`, 'error');
                return;
            }
        }

        for (let dyn of dynamicObstacles) {
            const dist = Math.hypot(p.x - dyn.mesh.position.x, p.y - dyn.mesh.position.y, p.z - dyn.mesh.position.z);
            if (dist < dyn.radius + 0.70) {
                isRunning = false;
                document.getElementById('flightStateBadge').textContent = 'CRASHED';
                setStatus('💥 與橫向動態飛鳥發生碰撞！請調高 4D 雷達預判秒數提前閃避。', 'error');
                return;
            }
        }

        if ((currentLevel === 1 || currentLevel === 2 || currentLevel === 5 || currentLevel === 6) && p.z <= -135.0) {
            isRunning = false;
            document.getElementById('flightStateBadge').textContent = 'SUCCESS';
            setStatus(`🎉 恭喜通過關卡 L${currentLevel}！無人機成功運用感測器穿越障礙走廊抵達終點！`, 'success');
            return;
        }

        if (currentLevel === 3 || currentLevel === 4) {
            if (tofData.agl <= 0.48 && p.z <= -125.0) {
                isRunning = false;
                if (tofData.over_pad && tofData.slope_deg < 5.0) {
                    document.getElementById('flightStateBadge').textContent = 'LANDED';
                    setStatus(`🎉 完美降落！成功通過關卡 L${currentLevel}，精準停靠於湖水綠安全停機坪！`, 'success');
                } else {
                    document.getElementById('flightStateBadge').textContent = 'CRASHED';
                    setStatus(`💥 降落失敗！觸地位置坡度為 ${tofData.slope_deg}° 或未對準停機坪中心。`, 'error');
                }
            }
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        initThree();

        const params = new URLSearchParams(window.location.search);
        const initLvl = Number(params.get('level')) || 1;
        selectLevel(initLvl);

        document.querySelectorAll('.level-btn').forEach(btn => {
            btn.addEventListener('click', () => selectLevel(btn.dataset.level));
        });

        document.getElementById('btnRun').addEventListener('click', compileAndRunStudent);
        document.getElementById('btnAutoDemo').addEventListener('click', compileAndRunDemo);
        document.getElementById('btnResetTodo').addEventListener('click', loadTodoOnly);
        document.getElementById('btnReset').addEventListener('click', resetDrone);
        document.getElementById('btnWeather').addEventListener('click', () => setWeather(!isBadWeather));

        document.getElementById('toggleStereo').addEventListener('change', e => { sensors.stereoEnabled = e.target.checked; });
        document.getElementById('toggleRadar').addEventListener('change', e => { sensors.radarEnabled = e.target.checked; });
        document.getElementById('toggleExtra').addEventListener('change', e => { sensors.extraEnabled = e.target.checked; });
        document.getElementById('toggleTof').addEventListener('change', e => { sensors.tofEnabled = e.target.checked; });

        const sliderSteer = document.getElementById('sliderSteer');
        sliderSteer.addEventListener('input', e => {
            window.LAB_PARAMS.steerGain = parseFloat(e.target.value);
            document.getElementById('valSteer').textContent = window.LAB_PARAMS.steerGain.toFixed(2);
        });

        const sliderPredict = document.getElementById('sliderPredict');
        sliderPredict.addEventListener('input', e => {
            window.LAB_PARAMS.predictTime = parseFloat(e.target.value);
            document.getElementById('valPredict').textContent = `${window.LAB_PARAMS.predictTime.toFixed(1)}s`;
        });

        const sliderSlope = document.getElementById('sliderSlope');
        sliderSlope.addEventListener('input', e => {
            window.LAB_PARAMS.maxSafeSlope = parseFloat(e.target.value);
            document.getElementById('valSlope').textContent = `${window.LAB_PARAMS.maxSafeSlope.toFixed(1)}°`;
        });

        requestAnimationFrame(animate);
    });
})();
