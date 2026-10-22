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
    const sensors = new window.SensorSuite();

    const droneState = {
        position: { x: 0, y: 8.0, z: 0 },
        velocity: { vx: 0, vy: 0, vz: 0 }
    };

    // 初始化 Three.js 場景 (富邦藍 × 湖水綠 × 淡紫 3D 視覺)
    function initThree() {
        const container = document.getElementById('canvasContainer');
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x061326); // 富邦深海藍背景
        scene.fog = new THREE.FogExp2(0x061326, 0.006);

        camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 300);
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(renderer.domElement);

        // 淡紫色環境光 + 湖水綠方向光
        scene.add(new THREE.AmbientLight(0xddd6fe, 0.72));
        const dirLight = new THREE.DirectionalLight(0x2dd4bf, 0.95);
        dirLight.position.set(20, 45, 30);
        scene.add(dirLight);

        // 地面跑道網格：湖水綠中線 (#00A59B) + 富邦藍格線 (#005BAC)
        const grid = new THREE.GridHelper(220, 80, 0x00A59B, 0x004a8f);
        grid.position.set(0, 0, -80);
        scene.add(grid);

        // 18m 限高防護網格 (紫紅雷射光網)
        const ceilingGeo = new THREE.PlaneGeometry(36, 190, 12, 40);
        const ceilingMat = new THREE.MeshBasicMaterial({
            color: 0xf43f5e,
            wireframe: true,
            transparent: true,
            opacity: 0.22
        });
        const ceilingMesh = new THREE.Mesh(ceilingGeo, ceilingMat);
        ceilingMesh.rotation.x = Math.PI / 2;
        ceilingMesh.position.set(0, MAX_ALTITUDE, -80);
        scene.add(ceilingMesh);

        // 建立四軸物流無人機模型 (富邦亮藍機身 + 淡紫色機臂 + 湖水綠光環)
        droneGroup = new THREE.Group();
        const bodyGeo = new THREE.BoxGeometry(1.4, 0.45, 1.4);
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x0076CE,
            emissive: 0x005BAC,
            emissiveIntensity: 0.35,
            metalness: 0.5,
            roughness: 0.2
        });
        droneGroup.add(new THREE.Mesh(bodyGeo, bodyMat));

        const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.2);
        const armMat = new THREE.MeshBasicMaterial({ color: 0xC4B5FD }); // 淡紫色機臂
        const arm1 = new THREE.Mesh(armGeo, armMat);
        arm1.rotation.z = Math.PI / 2;
        arm1.rotation.y = Math.PI / 4;
        const arm2 = arm1.clone();
        arm2.rotation.y = -Math.PI / 4;
        droneGroup.add(arm1, arm2);
        scene.add(droneGroup);

        // 雨霧粒子系統 (淡紫與湖水綠冰晶雨滴)
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
            new THREE.PointsMaterial({ color: 0xc4b5fd, size: 0.18, transparent: true, opacity: 0.68 })
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

    // 依據關卡建立 3D 障礙物
    function buildLevelScene(level) {
        while (obstacleGroup.children.length > 0) {
            obstacleGroup.remove(obstacleGroup.children[0]);
        }
        staticObstacles = [];
        dynamicObstacles = [];

        // 關卡 1 或 4：建立高壓細電線與樹幹
        if (level === 1 || level === 4) {
            const wireMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
            const wireConfigs = [
                { z: -28, y: 8.5, h: 2.2 },
                { z: -48, y: 11.2, h: 2.5 },
                { z: -68, y: 6.2, h: 2.5 },
                { z: -88, y: 9.2, h: 2.2 }
            ];
            wireConfigs.forEach(w => {
                const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 28), wireMat);
                mesh.rotation.z = Math.PI / 2;
                mesh.position.set(0, w.y, w.z);
                obstacleGroup.add(mesh);
                staticObstacles.push({ x: 0, y: w.y, z: w.z, hx: 14.0, hy: 0.9, hz: 0.4 });
            });

            // 垂直柱體 (淡紫光澤感電線桿)
            const poleConfigs = [
                { x: -3.5, z: -38 },
                { x: 3.2, z: -58 },
                { x: -1.5, z: -78 },
                { x: 4.0, z: -102 }
            ];
            const poleMat = new THREE.MeshStandardMaterial({ color: 0xa78bfa, roughness: 0.4 });
            poleConfigs.forEach(p => {
                const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 18), poleMat);
                mesh.position.set(p.x, 9, p.z);
                obstacleGroup.add(mesh);
                staticObstacles.push({ x: p.x, y: 9, z: p.z, hx: 0.9, hy: 9.0, hz: 0.9 });
            });
        }

        // 關卡 2 或 4：建立橫向移動動態巡邏機與飛鳥
        if (level === 2 || level === 4) {
            const dynConfigs = [
                { id: 1, z: -36, y: 8.5, x: -7, vx: 6.2, color: 0x2dd4bf },
                { id: 2, z: -64, y: 9.2, x: 7, vx: -6.8, color: 0xc4b5fd },
                { id: 3, z: -92, y: 8.8, x: -5, vx: 7.4, color: 0x2dd4bf },
                { id: 4, z: -114, y: 9.5, x: 6, vx: -6.0, color: 0xc4b5fd }
            ];
            dynConfigs.forEach(d => {
                const mesh = new THREE.Mesh(
                    new THREE.SphereGeometry(1.25, 16, 16),
                    new THREE.MeshStandardMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.45 })
                );
                mesh.position.set(d.x, d.y, d.z);
                obstacleGroup.add(mesh);
                dynamicObstacles.push({ id: d.id, mesh, vx: d.vx, vy: 0, vz: 0, radius: 1.25 });
            });
        }

        // 關卡 3 或 4：建立終點大樓屋頂、18°斜坡屋頂、水塔與湖水綠停機坪
        if (level === 3 || level === 4) {
            const building = new THREE.Mesh(
                new THREE.BoxGeometry(26, 8, 26),
                new THREE.MeshStandardMaterial({ color: 0x0a2246 }) // 富邦深藍大樓
            );
            building.position.set(0, 4, -138);
            obstacleGroup.add(building);

            // 左側危險斜坡屋頂
            const slopeMesh = new THREE.Mesh(
                new THREE.BoxGeometry(11, 0.6, 24),
                new THREE.MeshStandardMaterial({ color: 0x9f1239 })
            );
            slopeMesh.position.set(-6.8, 9.4, -138);
            slopeMesh.rotation.z = -0.32;
            obstacleGroup.add(slopeMesh);

            // 屋頂水塔 1 & 2 (淡紫金屬光澤)
            const towerMat = new THREE.MeshStandardMaterial({ color: 0xc4b5fd, metalness: 0.5, roughness: 0.3 });
            [roofConfig.tower1, roofConfig.tower2].forEach(t => {
                const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 3.6, 20), towerMat);
                tower.position.set(t.x, 9.8, t.z);
                obstacleGroup.add(tower);
            });

            // 湖水綠平坦安全停機坪 (H)
            const padMesh = new THREE.Mesh(
                new THREE.CylinderGeometry(2.7, 2.7, 0.25, 28),
                new THREE.MeshBasicMaterial({ color: 0x00A59B })
            );
            padMesh.position.set(roofConfig.pad.x, 8.15, roofConfig.pad.z);
            obstacleGroup.add(padMesh);
        } else {
            // 關卡 1 & 2 終點湖水綠拱門線 (Z = -135m)
            const goalMesh = new THREE.Mesh(
                new THREE.BoxGeometry(24, 0.4, 1.2),
                new THREE.MeshBasicMaterial({ color: 0x2dd4bf })
            );
            goalMesh.position.set(0, 0.2, -135);
            obstacleGroup.add(goalMesh);
        }
    }

    // 切換關卡並載入「學生填空練習 (TODO)」
    function selectLevel(level) {
        currentLevel = Number(level);
        isRunning = false;

        // 更新按鈕高亮 (富邦藍 × 湖水綠漸層按鈕)
        document.querySelectorAll('.level-btn').forEach(btn => {
            const active = Number(btn.dataset.level) === currentLevel;
            btn.className = active
                ? 'level-btn px-3 py-1 rounded text-xs font-bold btn-fubon-aqua transition'
                : 'level-btn px-3 py-1 rounded text-xs font-semibold text-violet-200/80 hover:bg-[#005BAC]/40 transition';
        });

        const info = window.LEVEL_DATA[currentLevel];
        document.getElementById('missionTitle').textContent = info.title;
        document.getElementById('missionBadge').textContent = info.badge;
        document.getElementById('missionDesc').textContent = info.desc;

        setWeather(currentLevel === 2);

        loadCodeTemplate('todo');
        resetDrone();
        buildLevelScene(currentLevel);
    }

    function loadCodeTemplate(mode) {
        const info = window.LEVEL_DATA[currentLevel];
        const editor = document.getElementById('codeEditor');
        const indicator = document.getElementById('codeModeIndicator');

        if (mode === 'todo') {
            editor.value = info.todo;
            indicator.textContent = '目前模式：📝 學生填空練習 (TODO)';
            indicator.className = 'text-[11px] text-violet-300 font-semibold';
        } else {
            editor.value = info.solution;
            indicator.textContent = '目前模式：💡 標準解答觀摩';
            indicator.className = 'text-[11px] text-teal-300 font-semibold';
        }
    }

    function setWeather(bad) {
        isBadWeather = bad;
        const btn = document.getElementById('btnWeather');
        if (isBadWeather) {
            btn.textContent = '🌧️ 濃霧豪雨 (光學退化)';
            btn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold badge-lavender transition';
            scene.fog.density = 0.028;
            rainSystem.visible = true;
        } else {
            btn.textContent = '☀️ 晴朗無霧';
            btn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#005BAC]/40 text-sky-200 border border-sky-400/40 hover:bg-[#005BAC]/70 transition';
            scene.fog.density = 0.006;
            rainSystem.visible = false;
        }
    }

    function resetDrone() {
        isRunning = false;
        droneState.position = { x: 0, y: (currentLevel === 3 ? 12.0 : 8.5), z: 0 };
        droneState.velocity = { vx: 0, vy: 0, vz: 0 };
        updateDroneMesh();
        setStatus('🟢 已重置無人機位置。修改程式碼或拉動上方滑桿後點擊「▶ 執行演算法」。', 'normal');
        document.getElementById('flightStateBadge').textContent = 'STANDBY';
    }

    function compileAndRun() {
        const code = document.getElementById('codeEditor').value;
        try {
            const CustomClass = new Function(`${code}; return StudentController;`)();
            studentController = new CustomClass();
            resetDrone();
            isRunning = true;
            document.getElementById('flightStateBadge').textContent = 'FLYING';
            setStatus('🚀 演算法執行中... 即時讀取感測器 API 與控制輸出', 'running');
        } catch (err) {
            setStatus(`❌ 語法錯誤：${err.message}`, 'error');
        }
    }

    function setStatus(msg, type) {
        const el = document.getElementById('statusText');
        el.textContent = msg;
        el.className = type === 'error'
            ? 'text-rose-300 font-semibold'
            : type === 'success'
            ? 'text-teal-300 font-bold'
            : 'text-violet-100';
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
            altBar.className = 'h-full bg-rose-500 transition-all duration-100';
            telPanel.classList.add('altitude-warning-active');
        } else {
            altBar.className = 'h-full bg-gradient-to-r from-[#005BAC] to-[#2DD4BF] transition-all duration-100';
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
        const radarList = sensors.compute4DRadarDetections(droneState.position, droneState.velocity, dynamicObstacles);
        const tofData = sensors.computeDownwardToF(droneState.position, roofConfig);
        sensors.renderHUDs();

        if (isRunning && studentController) {
            const api = {
                get_stereo_depth_map: () => depthMap,
                get_4d_radar_detections: () => radarList,
                get_downward_tof: () => tofData,
                get_stereo_quality: () => sensors.stereoQuality,
                set_debug_window: (r, c) => { sensors.debugWindow = { r, c }; }
            };

            try {
                const cmd = studentController.get_velocity(
                    { level: currentLevel, position: { ...droneState.position }, velocity: { ...droneState.velocity } },
                    api
                ) || { vx: 0, vy: 0, vz: 0 };

                droneState.velocity.vx = Math.max(-12, Math.min(12, Number(cmd.vx) || 0));
                droneState.velocity.vy = Math.max(-6, Math.min(6, Number(cmd.vy) || 0));
                droneState.velocity.vz = Math.max(-14, Math.min(5, Number(cmd.vz) || 0));
            } catch (e) {
                isRunning = false;
                setStatus(`❌ 執行期錯誤：${e.message}`, 'error');
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
            setStatus('🚨 觸發 18.0m 防作弊雷射限高網格！禁止直接飛越障礙物，請在走廊高度內避障。', 'error');
            return;
        }

        for (let obs of staticObstacles) {
            if (Math.abs(p.x - obs.x) < obs.hx + 0.55 &&
                Math.abs(p.y - obs.y) < obs.hy + 0.45 &&
                Math.abs(p.z - obs.z) < obs.hz + 0.55) {
                isRunning = false;
                document.getElementById('flightStateBadge').textContent = 'CRASHED';
                setStatus('💥 撞擊前方細電線或柱體！請調大「L1 轉向靈敏度」或減慢前進速度。', 'error');
                return;
            }
        }

        for (let dyn of dynamicObstacles) {
            const dist = Math.hypot(p.x - dyn.mesh.position.x, p.y - dyn.mesh.position.y, p.z - dyn.mesh.position.z);
            if (dist < dyn.radius + 0.75) {
                isRunning = false;
                document.getElementById('flightStateBadge').textContent = 'CRASHED';
                setStatus('💥 與橫向移動目標發生擦撞！請將「L2 預判未來秒數」調高至 1.5 秒提前閃避。', 'error');
                return;
            }
        }

        if ((currentLevel === 1 || currentLevel === 2) && p.z <= -135.0) {
            isRunning = false;
            document.getElementById('flightStateBadge').textContent = 'SUCCESS';
            setStatus(`🎉 恭喜通過關卡 ${currentLevel}！無人機成功穿越障礙走廊抵達終點！`, 'success');
            return;
        }

        if (currentLevel === 3 || currentLevel === 4) {
            if (tofData.agl <= 0.45 && p.z <= -125.0) {
                isRunning = false;
                if (tofData.over_pad && tofData.slope_deg < 5.0) {
                    document.getElementById('flightStateBadge').textContent = 'LANDED';
                    setStatus('🎉 完美降落！成功避開屋頂水塔與 18° 斜坡，精準停靠於湖水綠停機坪！', 'success');
                } else {
                    document.getElementById('flightStateBadge').textContent = 'CRASHED';
                    setStatus(`💥 降落失敗！觸地位置坡度為 ${tofData.slope_deg}° 或未對準停機坪。`, 'error');
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

        document.getElementById('btnRun').addEventListener('click', compileAndRun);
        document.getElementById('btnReset').addEventListener('click', resetDrone);
        document.getElementById('btnWeather').addEventListener('click', () => setWeather(!isBadWeather));

        document.getElementById('btnLoadTodo').addEventListener('click', () => loadCodeTemplate('todo'));
        document.getElementById('btnLoadSolution').addEventListener('click', () => loadCodeTemplate('solution'));

        document.getElementById('toggleStereo').addEventListener('change', e => { sensors.stereoEnabled = e.target.checked; });
        document.getElementById('toggleRadar').addEventListener('change', e => { sensors.radarEnabled = e.target.checked; });
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
