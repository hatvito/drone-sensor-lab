// js/sensors.js
class SensorSuite {
    constructor() {
        this.stereoEnabled = true;
        this.radarEnabled = true;
        this.tofEnabled = true;
        this.extraEnabled = true;

        this.debugWindow = { r: 6, c: 6 };
        this.lastDepthMap = Array.from({ length: 16 }, () => Array(16).fill(35.0));
        this.lastRadarTargets = [];
        this.lastLidarScan = [];
        this.lastProximity = { front: 20, left: 10, right: 10, back: 20 };
        this.lastOpticalFlow = [];
        this.lastTofData = {
            agl: 8.5,
            slope_deg: 0.0,
            is_safe_landing_zone: false,
            over_pad: false,
            pad_dx: 0,
            pad_dz: 0
        };
        this.stereoQuality = 1.0;

        this.ctxStereo = document.getElementById('hudStereo').getContext('2d');
        this.ctxRadar = document.getElementById('hudRadar').getContext('2d');
        this.ctxExtra = document.getElementById('hudExtra').getContext('2d');
        this.ctxTof = document.getElementById('hudTof').getContext('2d');
    }

    computeStereoQuality(dronePos, isBadWeather, currentLevel) {
        if (!this.stereoEnabled || currentLevel === 6) return 0.0;
        if (isBadWeather) return 0.12;
        if (currentLevel === 4 && dronePos.z < -45 && dronePos.z > -118) {
            return 0.12; // L4 中段局部濃霧區
        }
        return 1.0;
    }

    // 1. 雙目立體深度矩陣 (16x16)
    computeStereoDepthMap(dronePos, staticObstacles, dynamicObstacles, isBadWeather, currentLevel) {
        this.stereoQuality = this.computeStereoQuality(dronePos, isBadWeather, currentLevel);
        const maxRange = 35.0;
        const map = Array.from({ length: 16 }, () => Array(16).fill(maxRange));

        if (!this.stereoEnabled || currentLevel === 6) {
            this.lastDepthMap = map;
            return map;
        }

        const fovH = 56 * (Math.PI / 180);
        const fovV = 42 * (Math.PI / 180);

        for (let r = 0; r < 16; r++) {
            const pitch = ((7.5 - r) / 8.0) * (fovV / 2);
            for (let c = 0; c < 16; c++) {
                const yaw = ((c - 7.5) / 8.0) * (fovH / 2);

                if (this.stereoQuality < 0.3 && Math.random() < 0.72) {
                    map[r][c] = 2.0 + Math.random() * 28.0;
                    continue;
                }

                const dirX = Math.sin(yaw) * Math.cos(pitch);
                const dirY = Math.sin(pitch);
                const dirZ = -Math.cos(yaw) * Math.cos(pitch);
                let minDist = maxRange;

                for (let obs of staticObstacles) {
                    const dz = obs.z - dronePos.z;
                    if (dz >= 0 || dz < -maxRange) continue;
                    const t = -dz / (-dirZ);
                    if (t <= 0 || t >= minDist) continue;
                    const hitX = dronePos.x + dirX * t;
                    const hitY = dronePos.y + dirY * t;
                    if (Math.abs(hitX - obs.x) <= obs.hx + 0.65 && Math.abs(hitY - obs.y) <= obs.hy + 0.65) {
                        minDist = t;
                    }
                }

                for (let dyn of dynamicObstacles) {
                    const dz = dyn.mesh.position.z - dronePos.z;
                    if (dz >= 0 || dz < -maxRange) continue;
                    const t = -dz / (-dirZ);
                    if (t <= 0 || t >= minDist) continue;
                    const hitX = dronePos.x + dirX * t;
                    const hitY = dronePos.y + dirY * t;
                    if (Math.hypot(hitX - dyn.mesh.position.x, hitY - dyn.mesh.position.y) <= dyn.radius + 0.8) {
                        minDist = t;
                    }
                }
                map[r][c] = minDist;
            }
        }
        this.lastDepthMap = map;
        return map;
    }

    // 2. 4D 毫米波雷達 (僅偵測具有都卜勒相對速度之動態物體，靜止柱體會被濾除)
    compute4DRadarDetections(dronePos, droneVel, dynamicObstacles, currentLevel) {
        if (!this.radarEnabled || currentLevel === 6) {
            this.lastRadarTargets = [];
            return [];
        }
        const detections = [];
        for (let dyn of dynamicObstacles) {
            const x_rel = dyn.mesh.position.x - dronePos.x;
            const y_rel = dyn.mesh.position.y - dronePos.y;
            const z_rel = dyn.mesh.position.z - dronePos.z;
            const dist = Math.hypot(x_rel, y_rel, z_rel);

            if (dist <= 45.0 && z_rel < 4.0) {
                detections.push({
                    id: dyn.id,
                    dist: Number(dist.toFixed(2)),
                    x_rel: Number(x_rel.toFixed(2)),
                    y_rel: Number(y_rel.toFixed(2)),
                    z_rel: Number(z_rel.toFixed(2)),
                    rel_vx: Number((dyn.vx - droneVel.vx).toFixed(2)),
                    rel_vy: Number((dyn.vy - droneVel.vy).toFixed(2)),
                    rel_vz: Number((dyn.vz - droneVel.vz).toFixed(2))
                });
            }
        }
        this.lastRadarTargets = detections;
        return detections;
    }

    // 3. 下視 ToF 測距與斜率檢測
    computeDownwardToF(dronePos, roofConfig) {
        if (!this.tofEnabled) {
            return { agl: 99, slope_deg: 45, is_safe_landing_zone: false, over_pad: false, pad_dx: 0, pad_dz: 0 };
        }
        let groundHeight = 0.0;
        let slope_deg = 0.0;
        let isSafe = false;
        let overPad = false;

        if (dronePos.z <= -124.0 && dronePos.z >= -152.0 && Math.abs(dronePos.x) <= 14.0) {
            groundHeight = roofConfig.baseHeight; // 8.0m

            if (dronePos.x < -1.5) {
                slope_deg = 18.5;
                groundHeight += (-1.5 - dronePos.x) * 0.25;
            }
            const distTower1 = Math.hypot(dronePos.x - roofConfig.tower1.x, dronePos.z - roofConfig.tower1.z);
            const distTower2 = Math.hypot(dronePos.x - roofConfig.tower2.x, dronePos.z - roofConfig.tower2.z);
            if (distTower1 < 2.8 || distTower2 < 2.8) {
                groundHeight += 3.6;
                slope_deg = 32.0;
            }

            const distToPad = Math.hypot(dronePos.x - roofConfig.pad.x, dronePos.z - roofConfig.pad.z);
            if (distToPad < 3.0) {
                slope_deg = 1.2;
                isSafe = true;
                overPad = (distToPad < 2.3);
            } else if (slope_deg < 5.0) {
                slope_deg = 2.0;
                isSafe = true;
            }
        }

        const agl = Math.max(0.0, dronePos.y - groundHeight);
        const pad_dx = roofConfig.pad.x - dronePos.x;
        const pad_dz = roofConfig.pad.z - dronePos.z;

        this.lastTofData = {
            agl: Number(agl.toFixed(2)),
            slope_deg: Number(slope_deg.toFixed(1)),
            is_safe_landing_zone: isSafe,
            over_pad: overPad,
            pad_dx: Number(pad_dx.toFixed(2)),
            pad_dz: Number(pad_dz.toFixed(2))
        };
        return this.lastTofData;
    }

    // 4. 3D 主動光達點雲掃描 (15 道扇形雷射 Raycast，精準抓出靜止柱體與障礙物)
    computeLidarScan(dronePos, staticObstacles, dynamicObstacles) {
        if (!this.extraEnabled) {
            this.lastLidarScan = [];
            return [];
        }
        const maxRange = 30.0;
        const scan = [];

        for (let i = -7; i <= 7; i++) {
            const angle_deg = i * 8; // -56° ~ +56°
            const rad = angle_deg * (Math.PI / 180);
            const dirX = Math.sin(rad);
            const dirZ = -Math.cos(rad);
            let minDist = maxRange;

            // 射線步進檢測靜態柱體與牆壁
            for (let obs of staticObstacles) {
                if (Math.abs(obs.y - dronePos.y) > obs.hy + 1.0) continue;
                for (let d = 1.0; d < minDist; d += 0.5) {
                    const rx = dronePos.x + dirX * d;
                    const rz = dronePos.z + dirZ * d;
                    if (Math.abs(rx - obs.x) <= obs.hx + 0.7 && Math.abs(rz - obs.z) <= obs.hz + 0.7) {
                        minDist = d;
                        break;
                    }
                }
            }

            // 檢測動態物體
            for (let dyn of dynamicObstacles) {
                for (let d = 1.0; d < minDist; d += 0.6) {
                    const rx = dronePos.x + dirX * d;
                    const rz = dronePos.z + dirZ * d;
                    if (Math.hypot(rx - dyn.mesh.position.x, rz - dyn.mesh.position.z) <= dyn.radius + 0.6) {
                        minDist = d;
                        break;
                    }
                }
            }

            scan.push({
                angle_deg,
                angle: Number(rad.toFixed(2)),
                distance: Number(minDist.toFixed(2))
            });
        }
        this.lastLidarScan = scan;
        return scan;
    }

    // 5. 四周近距防撞超音波陣列 (Proximity Array)
    computeProximity(dronePos, staticObstacles) {
        if (!this.extraEnabled) {
            return { front: 20, left: 20, right: 20, back: 20 };
        }
        let front = 20.0, left = 20.0, right = 20.0, back = 20.0;

        for (let obs of staticObstacles) {
            if (Math.abs(dronePos.y - obs.y) > obs.hy + 1.0) continue;

            // 檢查是否在障礙物的 Z 軸重疊範圍內 -> 計算左右距離
            if (Math.abs(dronePos.z - obs.z) <= obs.hz + 1.8) {
                if (obs.x < dronePos.x) {
                    const dLeft = (dronePos.x - (obs.x + obs.hx));
                    if (dLeft >= 0 && dLeft < left) left = dLeft;
                } else {
                    const dRight = ((obs.x - obs.hx) - dronePos.x);
                    if (dRight >= 0 && dRight < right) right = dRight;
                }
            }

            // 檢查是否在障礙物的 X 軸重疊範圍內 -> 計算前方距離
            if (Math.abs(dronePos.x - obs.x) <= obs.hx + 1.4) {
                if (obs.z < dronePos.z) {
                    const dFront = (dronePos.z - (obs.z + obs.hz));
                    if (dFront >= 0 && dFront < front) front = dFront;
                }
            }
        }

        this.lastProximity = {
            front: Number(front.toFixed(2)),
            left: Number(left.toFixed(2)),
            right: Number(right.toFixed(2)),
            back: Number(back.toFixed(2))
        };
        return this.lastProximity;
    }

    // 6. 單眼迴旋光流與運動視差 (Optical Flow)
    computeOpticalFlow(dronePos, droneVel, staticObstacles) {
        if (!this.extraEnabled) {
            this.lastOpticalFlow = [];
            return [];
        }
        const flows = [];
        const speedZ = Math.max(1.0, -droneVel.vz);

        for (let obs of staticObstacles) {
            const dz = dronePos.z - obs.z; // 前方正值
            if (dz <= 0.8 || dz > 28.0) continue;
            const dx = obs.x - dronePos.x;
            const screen_x = dx / (dz * 0.75); // 投影至 -1.0 ~ +1.0 畫面座標
            if (Math.abs(screen_x) > 1.25) continue;

            // 運動視差公式：距離越近 (dz 越小)，像素膨脹與橫移速率 (flow_magnitude) 呈平方反比暴增
            const flow_magnitude = (speedZ * 42.0) / (dz * dz) + (Math.abs(dx) * speedZ * 12.0) / (dz * dz);

            flows.push({
                screen_x: Number(screen_x.toFixed(2)),
                flow_magnitude: Number(flow_magnitude.toFixed(1)),
                vx_px: Number(((screen_x >= 0 ? 1 : -1) * flow_magnitude).toFixed(1))
            });
        }
        this.lastOpticalFlow = flows;
        return flows;
    }

    renderHUDs(currentLevel) {
        this.drawStereoHUD();
        this.drawRadarHUD();
        this.drawExtraHUD(currentLevel);
        this.drawTofHUD();
    }

    drawStereoHUD() {
        const ctx = this.ctxStereo;
        const w = ctx.canvas.width, h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);

        const cellW = w / 16, cellH = h / 16;
        for (let r = 0; r < 16; r++) {
            for (let c = 0; c < 16; c++) {
                const d = this.lastDepthMap[r][c];
                const ratio = Math.min(1.0, Math.max(0.0, d / 35.0));
                const hue = Math.floor(ratio * 215);
                ctx.fillStyle = `hsl(${hue}, 85%, ${42 + ratio * 12}%)`;
                ctx.fillRect(c * cellW, r * cellH, cellW - 0.5, cellH - 0.5);
            }
        }

        if (this.debugWindow) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(this.debugWindow.c * cellW, this.debugWindow.r * cellH, cellW * 4, cellH * 4);
        }

        if (this.stereoQuality < 0.3) {
            ctx.fillStyle = 'rgba(220, 38, 38, 0.85)';
            ctx.fillRect(6, h - 20, w - 12, 16);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Inter';
            ctx.fillText('⚠️ 光學深度失效 / 濃霧雜訊', 14, h - 8);
        }
    }

    drawRadarHUD() {
        const ctx = this.ctxRadar;
        const w = ctx.canvas.width, h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);

        const cx = w / 2, cy = h - 10;
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.28)';
        ctx.lineWidth = 1;
        [30, 60, 90].forEach(radius => {
            ctx.beginPath();
            ctx.arc(cx, cy, radius, Math.PI * 1.18, Math.PI * 1.82);
            ctx.stroke();
        });

        for (let t of this.lastRadarTargets) {
            const px = cx + t.x_rel * 3.5;
            const py = cy + t.z_rel * 2.4;
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + t.rel_vx * 2.2, py);
            ctx.stroke();

            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // 第 3 個多功能 HUD：依關卡顯示 3D 光達扇形束 / 四周防撞雷達 / 單眼光流向量
    drawExtraHUD(currentLevel) {
        const ctx = this.ctxExtra;
        const w = ctx.canvas.width, h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);
        const titleEl = document.getElementById('extraHudTitle');

        if (currentLevel === 5) {
            titleEl.textContent = '3. 四周近距防撞陣列 (Sonar)';
            const cx = w / 2, cy = h / 2;
            const p = this.lastProximity;

            // 畫中心無人機
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(cx - 8, cy - 8, 16, 16);

            // 左側距離弧線
            ctx.strokeStyle = p.left < 3.8 ? '#f43f5e' : '#34d399';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cx - Math.min(65, p.left * 7), cy - 22);
            ctx.lineTo(cx - Math.min(65, p.left * 7), cy + 22);
            ctx.stroke();

            // 右側距離弧線
            ctx.strokeStyle = p.right < 3.8 ? '#f43f5e' : '#34d399';
            ctx.beginPath();
            ctx.moveTo(cx + Math.min(65, p.right * 7), cy - 22);
            ctx.lineTo(cx + Math.min(65, p.right * 7), cy + 22);
            ctx.stroke();

            ctx.fillStyle = '#e2e8f0';
            ctx.font = 'bold 11px JetBrains Mono';
            ctx.fillText(`L:${p.left.toFixed(1)}m`, 8, cy + 4);
            ctx.fillText(`R:${p.right.toFixed(1)}m`, w - 54, cy + 4);
            ctx.fillText(`F:${p.front.toFixed(1)}m`, cx - 22, 16);
        } else if (currentLevel === 6) {
            titleEl.textContent = '3. 單眼迴旋光流 (Optical Flow)';
            const cx = w / 2, cy = h / 2;
            // 繪製焦點擴張中心 (FOE)
            ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
            ctx.beginPath();
            ctx.arc(cx, cy, 6, 0, Math.PI * 2);
            ctx.stroke();

            for (let f of this.lastOpticalFlow) {
                const px = cx + f.screen_x * 65;
                const len = Math.min(45, f.flow_magnitude * 0.8);
                ctx.strokeStyle = f.flow_magnitude > 24 ? '#f43f5e' : '#38bdf8';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(px, cy);
                ctx.lineTo(px + (f.screen_x >= 0 ? len : -len), cy);
                ctx.stroke();

                ctx.fillStyle = '#fb7185';
                ctx.beginPath();
                ctx.arc(px, cy, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            titleEl.textContent = '3. 3D 主動光達點雲 (LiDAR)';
            const cx = w / 2, cy = h - 10;
            for (let ray of this.lastLidarScan) {
                const len = (ray.distance / 30.0) * 95;
                const tx = cx + Math.sin(ray.angle) * len;
                const ty = cy - Math.cos(ray.angle) * len;

                ctx.strokeStyle = ray.distance < 15.0 ? 'rgba(244, 63, 94, 0.75)' : 'rgba(129, 140, 248, 0.35)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(tx, ty);
                ctx.stroke();

                ctx.fillStyle = ray.distance < 15.0 ? '#f43f5e' : '#34d399';
                ctx.beginPath();
                ctx.arc(tx, ty, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    drawTofHUD() {
        const ctx = this.ctxTof;
        const w = ctx.canvas.width, h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);

        const d = this.lastTofData;
        ctx.font = 'bold 11px JetBrains Mono';
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(`對地高度 AGL : ${d.agl.toFixed(1)} m`, 10, 22);

        const slopeOk = d.slope_deg < 5.0;
        ctx.fillStyle = slopeOk ? '#34d399' : '#f87171';
        ctx.fillText(`屋頂斜率 Slope: ${d.slope_deg.toFixed(1)}° ${slopeOk ? '(平坦)' : '(危險!)'}`, 10, 44);

        ctx.fillStyle = d.over_pad ? '#38bdf8' : '#cbd5e1';
        ctx.fillText(`停機坪狀態   : ${d.over_pad ? '✅ 已對準中心' : '導引搜尋中...'}`, 10, 66);
    }
}

window.SensorSuite = SensorSuite;
