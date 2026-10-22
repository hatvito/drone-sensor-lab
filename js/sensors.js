// js/sensors.js
class SensorSuite {
    constructor() {
        this.stereoEnabled = true;
        this.radarEnabled = true;
        this.tofEnabled = true;
        this.lidarEnabled = true;
        this.proxEnabled = true;
        this.flowEnabled = true;

        this.debugWindow = { r: 6, c: 6 };
        this.lastDepthMap = Array.from({ length: 16 }, () => Array(16).fill(35.0));
        this.lastRadarTargets = [];
        this.lastLidarScan = [];
        this.lastProximity = { front: 10, left: 5, right: 5, back: 10 };
        this.lastOpticalFlow = [];
        this.lastTofData = { agl: 8.0, slope_deg: 0.0, is_safe_landing_zone: false, over_pad: false, pad_dx: 0, pad_dz: 0 };
        this.stereoQuality = 1.0;

        this.ctxStereo = document.getElementById('hudStereo').getContext('2d');
        this.ctxRadar = document.getElementById('hudRadar').getContext('2d');
        this.ctxTof = document.getElementById('hudTof').getContext('2d');
    }

    computeStereoQuality(dronePos, isBadWeather, currentLevel) {
        if (!this.stereoEnabled) return 0.0;
        if (isBadWeather) return 0.12;
        if ((currentLevel === 4 || currentLevel === 6) && dronePos.z < -40 && dronePos.z > -120) return 0.1;
        return 1.0;
    }

    computeStereoDepthMap(dronePos, staticObstacles, dynamicObstacles, isBadWeather, currentLevel) {
        this.stereoQuality = this.computeStereoQuality(dronePos, isBadWeather, currentLevel);
        const maxRange = 35.0;
        const map = Array.from({ length: 16 }, () => Array(16).fill(maxRange));
        if (!this.stereoEnabled) return map;

        const fovH = 56 * (Math.PI / 180), fovV = 42 * (Math.PI / 180);
        for (let r = 0; r < 16; r++) {
            const pitch = ((7.5 - r) / 8.0) * (fovV / 2);
            for (let c = 0; c < 16; c++) {
                const yaw = ((c - 7.5) / 8.0) * (fovH / 2);
                if (this.stereoQuality < 0.3 && Math.random() < 0.68) {
                    map[r][c] = 2.0 + Math.random() * 30.0;
                    continue;
                }
                const dirX = Math.sin(yaw) * Math.cos(pitch), dirY = Math.sin(pitch), dirZ = -Math.cos(yaw) * Math.cos(pitch);
                let minDist = maxRange;

                for (let obs of staticObstacles) {
                    const dz = obs.z - dronePos.z;
                    if (dz >= 0 || dz < -maxRange) continue;
                    const t = -dz / (-dirZ);
                    if (t <= 0 || t >= minDist) continue;
                    const hitX = dronePos.x + dirX * t, hitY = dronePos.y + dirY * t;
                    if (Math.abs(hitX - obs.x) <= obs.hx + 0.65 && Math.abs(hitY - obs.y) <= obs.hy + 0.65) minDist = t;
                }
                for (let dyn of dynamicObstacles) {
                    const dz = dyn.mesh.position.z - dronePos.z;
                    if (dz >= 0 || dz < -maxRange) continue;
                    const t = -dz / (-dirZ);
                    if (t <= 0 || t >= minDist) continue;
                    const hitX = dronePos.x + dirX * t, hitY = dronePos.y + dirY * t;
                    if (Math.hypot(hitX - dyn.mesh.position.x, hitY - dyn.mesh.position.y) <= dyn.radius + 0.8) minDist = t;
                }
                map[r][c] = minDist;
            }
        }
        this.lastDepthMap = map;
        return map;
    }

    compute4DRadarDetections(dronePos, droneVel, dynamicObstacles) {
        if (!this.radarEnabled) return [];
        const detections = [];
        for (let dyn of dynamicObstacles) {
            const x_rel = dyn.mesh.position.x - dronePos.x, y_rel = dyn.mesh.position.y - dronePos.y, z_rel = dyn.mesh.position.z - dronePos.z;
            const dist = Math.hypot(x_rel, y_rel, z_rel);
            if (dist <= 45.0 && z_rel < 4.0) {
                detections.push({
                    dist: Number(dist.toFixed(2)),
                    x_rel: Number(x_rel.toFixed(2)),
                    y_rel: Number(y_rel.toFixed(2)),
                    z_rel: Number(z_rel.toFixed(2)),
                    rel_vx: Number((dyn.vx - droneVel.vx).toFixed(2))
                });
            }
        }
        this.lastRadarTargets = detections;
        return detections;
    }

    computeDownwardToF(dronePos, roofConfig) {
        if (!this.tofEnabled) return { agl: 99, slope_deg: 45, is_safe_landing_zone: false, over_pad: false, pad_dx: 0, pad_dz: 0 };
        let groundHeight = 8.0, slope_deg = 0.0, isSafe = false, overPad = false;
        if (dronePos.z <= -124.0 && dronePos.z >= -152.0 && Math.abs(dronePos.x) <= 14.0) {
            if (dronePos.x < -1.5) { slope_deg = 18.5; groundHeight += (-1.5 - dronePos.x) * 0.25; }
            const distPad = Math.hypot(dronePos.x - roofConfig.pad.x, dronePos.z - roofConfig.pad.z);
            if (distPad < 3.2) { slope_deg = 1.2; isSafe = true; overPad = (distPad < 2.3); }
        }
        const agl = Math.max(0.0, dronePos.y - groundHeight);
        const pad_dx = roofConfig.pad.x - dronePos.x, pad_dz = roofConfig.pad.z - dronePos.z;
        this.lastTofData = { agl: Number(agl.toFixed(2)), slope_deg: Number(slope_deg.toFixed(1)), is_safe_landing_zone: isSafe, over_pad: overPad, pad_dx: Number(pad_dx.toFixed(2)), pad_dz: Number(pad_dz.toFixed(2)) };
        return this.lastTofData;
    }

    // 4. 3D 光達點雲掃描 (不論動靜態與濃霧，精準抓出前方柱體)
    computeLidarScan(dronePos, staticObstacles) {
        if (!this.lidarEnabled) return [];
        const scan = [];
        const angles = [-0.6, -0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45, 0.6];
        for (let angle of angles) {
            let minD = 35.0;
            const dirX = Math.sin(angle), dirZ = -Math.cos(angle);
            for (let obs of staticObstacles) {
                const dz = obs.z - dronePos.z, dx = obs.x - dronePos.x;
                const dist = Math.hypot(dx, dz);
                if (dist < minD && Math.abs(dx - dirX * dist) < 1.5) minD = Math.max(0.5, dist - 1.0);
            }
            scan.push({ angle: Number(angle.toFixed(2)), distance: Number(minD.toFixed(2)) });
        }
        this.lastLidarScan = scan;
        return scan;
    }

    // 5. 四周近距防撞陣列
    computeProximity(dronePos) {
        if (!this.proxEnabled) return { front: 10, left: 10, right: 10, back: 10 };
        const left = Math.max(0.5, 6.0 + dronePos.x);
        const right = Math.max(0.5, 6.0 - dronePos.x);
        const front = 15.0;
        this.lastProximity = { front, left: Number(left.toFixed(1)), right: Number(right.toFixed(1)), back: 10.0 };
        return this.lastProximity;
    }

    // 6. 光流與視差特徵追蹤
    computeOpticalFlow(dronePos) {
        if (!this.flowEnabled) return [];
        const flows = [];
        if (Math.abs(dronePos.x) > 4.5) {
            flows.push({ x_px: dronePos.x > 0 ? 150 : 26, speed_px: 48.5 });
        }
        this.lastOpticalFlow = flows;
        return flows;
    }

    renderHUDs() {
        this.drawStereoHUD();
        this.drawRadarHUD();
        this.drawTofHUD();
    }

    drawStereoHUD() {
        const ctx = this.ctxStereo, w = ctx.canvas.width, h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);
        const cellW = w / 16, cellH = h / 16;
        for (let r = 0; r < 16; r++) {
            for (let c = 0; c < 16; c++) {
                const d = this.lastDepthMap[r][c], ratio = Math.min(1.0, Math.max(0.0, d / 35.0));
                ctx.fillStyle = `hsl(${Math.floor(ratio * 215)}, 85%, ${42 + ratio * 12}%)`;
                ctx.fillRect(c * cellW, r * cellH, cellW - 0.5, cellH - 0.5);
            }
        }
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
        ctx.strokeRect(this.debugWindow.c * cellW, this.debugWindow.r * cellH, cellW * 4, cellH * 4);
    }

    drawRadarHUD() {
        const ctx = this.ctxRadar, w = ctx.canvas.width, h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2, cy = h - 12;
        ctx.strokeStyle = 'rgba(0, 137, 123, 0.3)';
        [35, 70, 105].forEach(radius => {
            ctx.beginPath(); ctx.arc(cx, cy, radius, Math.PI * 1.18, Math.PI * 1.82); ctx.stroke();
        });
        for (let t of this.lastRadarTargets) {
            ctx.fillStyle = '#00897B'; ctx.beginPath(); ctx.arc(cx + t.x_rel * 3.8, cy + t.z_rel * 2.8, 4, 0, Math.PI * 2); ctx.fill();
        }
    }

    drawTofHUD() {
        const ctx = this.ctxTof, w = ctx.canvas.width, h = ctx.canvas.height;
        ctx.clearRect(0, 0, w, h);
        const d = this.lastTofData;
        ctx.font = 'bold 12px JetBrains Mono'; ctx.fillStyle = '#0F172A';
        ctx.fillText(`AGL Height: ${d.agl.toFixed(1)} m`, 10, 25);
        ctx.fillText(`Roof Slope: ${d.slope_deg.toFixed(1)}°`, 10, 50);
        ctx.fillText(`Pad Status: ${d.over_pad ? '✅ Aligned' : 'Searching...'}`, 10, 75);
    }
}
window.SensorSuite = SensorSuite;
