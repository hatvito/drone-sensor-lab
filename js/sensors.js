// js/sensors.js
class SensorSuite {
    constructor() {
        this.stereoEnabled = true;
        this.radarEnabled = true;
        this.tofEnabled = true;

        this.debugWindow = { r: 6, c: 6 };
        this.lastDepthMap = Array.from({ length: 16 }, () => Array(16).fill(35.0));
        this.lastRadarTargets = [];
        this.lastTofData = {
            agl: 8.0,
            slope_deg: 0.0,
            is_safe_landing_zone: false,
            over_pad: false,
            pad_dx: 0,
            pad_dz: 0
        };
        this.stereoQuality = 1.0;

        this.ctxStereo = document.getElementById('hudStereo').getContext('2d');
        this.ctxRadar = document.getElementById('hudRadar').getContext('2d');
        this.ctxTof = document.getElementById('hudTof').getContext('2d');
    }

    // 計算光學雙目可靠度 (晴天 1.0，濃霧或進入 L4 濃霧區時驟降)
    computeStereoQuality(dronePos, isBadWeather, currentLevel) {
        if (!this.stereoEnabled) return 0.0;
        if (isBadWeather) return 0.12;
        if (currentLevel === 4 && dronePos.z < -55 && dronePos.z > -115) {
            return 0.15; // 關卡四中段局部濃霧區
        }
        return 1.0;
    }

    // 1. 產生 16x16 雙目立體深度圖
    computeStereoDepthMap(dronePos, staticObstacles, dynamicObstacles, isBadWeather, currentLevel) {
        this.stereoQuality = this.computeStereoQuality(dronePos, isBadWeather, currentLevel);
        const maxRange = 35.0;
        const map = Array.from({ length: 16 }, () => Array(16).fill(maxRange));

        if (!this.stereoEnabled) {
            this.lastDepthMap = map;
            return map;
        }

        const fovH = 56 * (Math.PI / 180);
        const fovV = 42 * (Math.PI / 180);

        for (let r = 0; r < 16; r++) {
            const pitch = ((7.5 - r) / 8.0) * (fovV / 2);
            for (let c = 0; c < 16; c++) {
                const yaw = ((c - 7.5) / 8.0) * (fovH / 2);

                // 光學天候雜訊模擬
                if (this.stereoQuality < 0.3 && Math.random() < 0.68) {
                    map[r][c] = 2.0 + Math.random() * 30.0;
                    continue;
                }

                const dirX = Math.sin(yaw) * Math.cos(pitch);
                const dirY = Math.sin(pitch);
                const dirZ = -Math.cos(yaw) * Math.cos(pitch);

                let minDist = maxRange;

                // 檢測前方細電線、樹幹與靜態障礙物包圍盒
                for (let obs of staticObstacles) {
                    const dz = obs.z - dronePos.z;
                    if (dz >= 0 || dz < -maxRange) continue;
                    const t = -dz / (-dirZ);
                    if (t <= 0 || t >= minDist) continue;

                    const hitX = dronePos.x + dirX * t;
                    const hitY = dronePos.y + dirY * t;

                    if (Math.abs(hitX - obs.x) <= obs.hx + 0.65 &&
                        Math.abs(hitY - obs.y) <= obs.hy + 0.65) {
                        minDist = t;
                    }
                }

                // 檢測動態障礙物
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

    // 2. 產生 4D 毫米波雷達目標點雲 (含都卜勒相對速度)
    compute4DRadarDetections(dronePos, droneVel, dynamicObstacles) {
        if (!this.radarEnabled) {
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
                const azimuth = Math.atan2(x_rel, -z_rel) * (180 / Math.PI);
                const elevation = Math.atan2(y_rel, Math.hypot(x_rel, z_rel)) * (180 / Math.PI);
                detections.push({
                    id: dyn.id,
                    dist: Number(dist.toFixed(2)),
                    azimuth: Number(azimuth.toFixed(1)),
                    elevation: Number(elevation.toFixed(1)),
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

    // 3. 產生下視 ToF 測距與屋頂平坦度資料
    computeDownwardToF(dronePos, roofConfig) {
        if (!this.tofEnabled) {
            return { agl: 99, slope_deg: 45, is_safe_landing_zone: false, over_pad: false, pad_dx: 0, pad_dz: 0 };
        }

        let groundHeight = 0.0;
        let slope_deg = 0.0;
        let isSafe = false;
        let overPad = false;

        // 檢查是否位於終點大樓屋頂範圍 (Z: -126 ~ -150, X: -14 ~ +14)
        if (dronePos.z <= -124.0 && dronePos.z >= -152.0 && Math.abs(dronePos.x) <= 14.0) {
            groundHeight = roofConfig.baseHeight; // 8.0m

            // 檢查是否位於左側 18° 斜坡屋頂區 (X < -1.5)
            if (dronePos.x < -1.5) {
                slope_deg = 18.5;
                groundHeight += (-1.5 - dronePos.x) * 0.25;
            }
            // 檢查是否位於水塔或冷卻塔上方
            const distTower1 = Math.hypot(dronePos.x - roofConfig.tower1.x, dronePos.z - roofConfig.tower1.z);
            const distTower2 = Math.hypot(dronePos.x - roofConfig.tower2.x, dronePos.z - roofConfig.tower2.z);
            if (distTower1 < 3.0 || distTower2 < 2.8) {
                groundHeight += 3.6;
                slope_deg = 32.0;
            }

            // 檢查是否對準綠色平坦停機坪
            const distToPad = Math.hypot(dronePos.x - roofConfig.pad.x, dronePos.z - roofConfig.pad.z);
            if (distToPad < 3.2) {
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

    // 繪製三大感測器 Canvas HUD
    renderHUDs() {
        this.drawStereoHUD();
        this.drawRadarHUD();
        this.drawTofHUD();
    }

    drawStereoHUD() {
        const ctx = this.ctxStereo;
        const w = ctx.canvas.width, h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);

        if (!this.stereoEnabled) {
            ctx.fillStyle = '#475569';
            ctx.font = '11px Inter';
            ctx.fillText('雙目視覺已關閉 (OFF)', 36, h / 2);
            return;
        }

        const cellW = w / 16, cellH = h / 16;
        for (let r = 0; r < 16; r++) {
            for (let c = 0; c < 16; c++) {
                const d = this.lastDepthMap[r][c];
                const ratio = Math.min(1.0, Math.max(0.0, d / 35.0));
                // 近處紅橘色 (0°)，遠處科技藍 (215°)
                const hue = Math.floor(ratio * 215);
                ctx.fillStyle = `hsl(${hue}, 85%, ${42 + ratio * 12}%)`;
                ctx.fillRect(c * cellW, r * cellH, cellW - 0.5, cellH - 0.5);
            }
        }

        // 畫出學生設定的 4x4 安全連通視窗白框
        if (this.debugWindow) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(
                this.debugWindow.c * cellW,
                this.debugWindow.r * cellH,
                cellW * 4,
                cellH * 4
            );
        }

        // 若濃霧干擾顯示警告標籤
        if (this.stereoQuality < 0.3) {
            ctx.fillStyle = 'rgba(220, 38, 38, 0.82)';
            ctx.fillRect(8, h - 22, w - 16, 18);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Inter';
            ctx.fillText('⚠️ 濃霧光學散射：信賴度極低', 16, h - 9);
        }
    }

    drawRadarHUD() {
        const ctx = this.ctxRadar;
        const w = ctx.canvas.width, h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);

        const cx = w / 2, cy = h - 12;

        // 繪製雷達扇形距離環
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.25)';
        ctx.lineWidth = 1;
        [35, 70, 105].forEach(radius => {
            ctx.beginPath();
            ctx.arc(cx, cy, radius, Math.PI * 1.18, Math.PI * 1.82);
            ctx.stroke();
        });

        // 扇形邊界線
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - 75, 12);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + 75, 12);
        ctx.stroke();

        if (!this.radarEnabled) {
            ctx.fillStyle = '#475569';
            ctx.font = '11px Inter';
            ctx.fillText('4D 雷達已關閉 (OFF)', 36, h / 2);
            return;
        }

        // 繪製動態目標與都卜勒相對速度向量箭頭
        for (let t of this.lastRadarTargets) {
            const px = cx + t.x_rel * 3.8;
            const py = cy + t.z_rel * 2.8;

            // 速度向量箭頭 (預判軌跡線)
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + t.rel_vx * 2.8, py);
            ctx.stroke();

            // 目標亮點
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawTofHUD() {
        const ctx = this.ctxTof;
        const w = ctx.canvas.width, h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);

        const d = this.lastTofData;
        ctx.font = '11px JetBrains Mono';
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(`對地高度 AGL : ${d.agl.toFixed(1)} m`, 10, 22);

        const slopeOk = d.slope_deg < 5.0;
        ctx.fillStyle = slopeOk ? '#34d399' : '#f87171';
        ctx.fillText(`屋頂斜率 Slope: ${d.slope_deg.toFixed(1)}° ${slopeOk ? '(平坦)' : '(危險!)'}`, 10, 42);

        ctx.fillStyle = d.over_pad ? '#38bdf8' : '#94a3b8';
        ctx.fillText(`停機坪對位   : ${d.over_pad ? '✅ 已對準中心' : '導引搜尋中...'}`, 10, 62);

        // 繪製底部坡度視覺線
        ctx.strokeStyle = slopeOk ? '#10b981' : '#ef4444';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const rad = (d.slope_deg * Math.PI) / 180;
        ctx.moveTo(25, 84 + Math.sin(rad) * 14);
        ctx.lineTo(w - 25, 84 - Math.sin(rad) * 14);
        ctx.stroke();
    }
}

window.SensorSuite = SensorSuite;
