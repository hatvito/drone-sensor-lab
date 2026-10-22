// js/templates.js
window.LAB_PARAMS = {
    steerGain: 0.20,      
    predictTime: 0.0,     
    maxSafeSlope: 5.0     
};

window.LEVEL_DATA = {
    1: {
        title: "關卡一：雙目立體視覺相機 (Stereo Vision)",
        badge: "目標：穿越細電線抵達 Z = -135m",
        desc: "前方有傳統光達易漏檢的極細高壓電線與樹枝。請在 16×16 深度矩陣中找出最遠（最藍）的 4×4 安全視窗，並調整【TODO】區的轉向靈敏度與安全減速距離！",
        todo: `class StudentController {
    constructor() { this.step = 0; }
    get_velocity(state, api) {
        this.step++;
        const map = api.get_stereo_depth_map();
        let bestR = 6, bestC = 6, maxDepth = -1;
        for (let r = 2; r <= 10; r++) {
            for (let c = 1; c <= 11; c++) {
                let sum = 0;
                for (let dr = 0; dr < 4; dr++)
                    for (let dc = 0; dc < 4; dc++) sum += map[r + dr][c + dc];
                let avg = sum / 16.0;
                if (avg > maxDepth) { maxDepth = avg; bestR = r; bestC = c; }
            }
        }
        api.set_debug_window(bestR, bestC);
        const steerGain = window.LAB_PARAMS.steerGain; 
        let vx = ((bestC + 1.5) - 7.5) * steerGain;
        let vy = (7.5 - (bestR + 1.5)) * (steerGain * 0.75);
        let vz = (maxDepth < 14.0) ? -4.5 : -9.0;
        return { vx, vy, vz };
    }
}`,
        solution: `class StudentController {
    constructor() { this.smoothVx = 0; this.smoothVy = 0; }
    get_velocity(state, api) {
        const map = api.get_stereo_depth_map();
        let bestR = 6, bestC = 6, maxscore = -999;
        for (let r = 2; r <= 10; r++) {
            for (let c = 1; c <= 11; c++) {
                let sum = 0, minCell = 999;
                for (let dr = 0; dr < 4; dr++) {
                    for (let dc = 0; dc < 4; dc++) {
                        const d = map[r + dr][c + dc];
                        sum += d;
                        if (d < minCell) minCell = d;
                    }
                }
                const score = (sum / 16.0) + minCell * 0.6 - Math.abs((c + 1.5) - 7.5) * 0.4;
                if (score > maxscore) { maxscore = score; bestR = r; bestC = c; }
            }
        }
        api.set_debug_window(bestR, bestC);
        const targetVx = ((bestC + 1.5) - 7.5) * 0.72;
        const targetVy = (7.5 - (bestR + 1.5)) * 0.50 + (8.5 - state.position.y) * 0.4;
        this.smoothVx = this.smoothVx * 0.6 + targetVx * 0.4;
        this.smoothVy = this.smoothVy * 0.6 + targetVy * 0.4;
        return { vx: this.smoothVx, vy: this.smoothVy, vz: -8.5 };
    }
}`
    },

    2: {
        title: "關卡二：4D 毫米波雷達 (4D mmWave Radar)",
        badge: "目標：濃霧中閃避動態機群抵達 Z = -135m",
        desc: "濃霧暴雨下光學雙目相機已失效！請利用 4D 毫米波雷達回傳的「都卜勒相對速度 (rel_vx)」，預判橫向移動飛鳥與巡邏機 1.5 秒後的未來位置並提前閃避。",
        todo: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const targets = api.get_4d_radar_detections();
        let vx = -pos.x * 0.6, vy = (9.0 - pos.y) * 1.2, vz = -8.5;
        const predictSec = window.LAB_PARAMS.predictTime;
        for (let t of targets) {
            if (t.z_rel < 0 && t.dist < 32.0) {
                const futureX = t.x_rel + (t.rel_vx * predictSec);
                if (Math.abs(futureX) < 5.5) {
                    vx += (futureX > 0) ? -7.5 : 7.5;
                    vy += (t.y_rel > 0) ? -2.5 : 2.5;
                    vz = -5.5;
                }
            }
        }
        return { vx, vy, vz };
    }
}`,
        solution: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const targets = api.get_4d_radar_detections();
        let vx = -pos.x * 0.55, vy = (9.0 - pos.y) * 1.2, vz = -9.0;
        for (let t of targets) {
            if (t.z_rel < 0 && t.dist < 35.0) {
                const ttc = Math.min(2.2, Math.abs(t.z_rel) / Math.max(1.0, -t.rel_vz));
                const futureX = t.x_rel + t.rel_vx * ttc;
                const futureY = t.y_rel + t.rel_vy * ttc;
                if (Math.abs(futureX) < 5.8 && Math.abs(futureY) < 4.0) {
                    vx += (futureX >= 0 ? -1 : 1) * 8.0;
                    vy += (futureY >= 0 ? -2.5 : 2.5);
                    vz = -5.5;
                }
            }
        }
        return { vx, vy, vz };
    }
}`
    },

    3: {
        title: "關卡三：下視 ToF 測距與屋頂精準降落",
        badge: "目標：避開斜坡與水塔，精準降落於綠色停機坪",
        desc: "終點大樓屋頂有水塔與 18° 斜坡屋頂。請檢查下視 ToF 回傳的屋頂斜率 (slope_deg < 5°) 與停機坪對位狀態 (over_pad)，確認平坦後才執行垂直緩降！",
        todo: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const tof = api.get_downward_tof();
        if (pos.z > -126.0) return { vx: -pos.x * 0.8, vy: (12.5 - pos.y) * 1.5, vz: -10.5 };
        let vx = tof.pad_dx * 1.8, vz = tof.pad_dz * 1.8, vy = (11.2 - pos.y) * 1.2;
        if (tof.over_pad && tof.slope_deg < window.LAB_PARAMS.maxSafeSlope && tof.is_safe_landing_zone) {
            vy = -0.2; // 📝 TODO: 改為 -2.2 完成降落
        }
        return { vx, vy, vz };
    }
}`,
        solution: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const tof = api.get_downward_tof();
        if (pos.z > -126.0) return { vx: -pos.x * 0.9, vy: (12.5 - pos.y) * 1.5, vz: -11.0 };
        let vx = tof.pad_dx * 2.2, vz = tof.pad_dz * 2.2, vy = (11.5 - pos.y) * 1.2;
        if (tof.slope_deg > 10.0 && !tof.over_pad) { vy = 2.5; vx += (pos.x < 5.0 ? 3.0 : -3.0); }
        if (tof.over_pad && tof.slope_deg < 5.0 && tof.is_safe_landing_zone) {
            vx = tof.pad_dx * 1.2; vz = tof.pad_dz * 1.2;
            vy = (tof.agl < 2.0) ? -1.2 : -2.4;
        }
        return { vx, vy, vz };
    }
}`
    },

    4: {
        title: "關卡四：3D 光達 (3D LiDAR) 點雲掃描",
        badge: "目標：利用主動光達突破靜止柱體與濃霧障礙",
        desc: "都卜勒雷達抓不到靜止物體，濃霧又讓雙目相機失效。請使用 api.get_lidar_scan() 讀取前方扇形雷射點雲陣列，找出距離最近的障礙物並主動避開！",
        todo: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const lidar = api.get_lidar_scan(); // 取得前方扇形 15 道雷射距離
        let vx = -pos.x * 0.5, vy = (9.0 - pos.y) * 1.2, vz = -8.5;

        // 📝 TODO: 請巡檢 lidar 點雲陣列。如果有任何一道雷射距離 < 10m，請根據其角度進行側向閃避！
        for (let ray of lidar) {
            if (ray.distance < 10.0) {
                vx += (ray.angle < 0) ? 5.0 : -5.0; // 根據雷射角度反向閃避
                vz = -4.0;
            }
        }
        return { vx, vy, vz };
    }
}`,
        solution: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const lidar = api.get_lidar_scan();
        let vx = -pos.x * 0.5, vy = (9.0 - pos.y) * 1.2, vz = -9.0;
        for (let ray of lidar) {
            if (ray.distance < 11.0) {
                const avoidDir = (ray.angle < 0) ? 6.5 : -6.5;
                vx += avoidDir;
                vz = -4.5;
            }
        }
        return { vx, vy, vz };
    }
}`
    },

    5: {
        title: "關卡五：四周近距防撞陣列 (Proximity Array)",
        badge: "目標：高樓側風夾縫中利用四向防撞反彈脫困",
        desc: "在狹窄的都會高樓夾縫中飛行，突發側風將無人機吹向牆壁。請使用 api.get_proximity() 監控四周距離，當任一方向過近時立即觸發硬體級反彈！",
        todo: `class StudentController {
    get_velocity(state, api) {
        const prox = api.get_proximity(); // 回傳 { front, left, right, back }
        let vx = 0, vy = 0, vz = -8.0;

        // 📝 TODO: 如果左側距離 left < 2.0，請往右彈開 (+5.0)；若右側 right < 2.0，往左彈開 (-5.0)
        if (prox.left < 2.0) vx = 5.0;
        if (prox.right < 2.0) vx = -5.0;

        return { vx, vy, vz };
    }
}`,
        solution: `class StudentController {
    get_velocity(state, api) {
        const prox = api.get_proximity();
        let vx = 0, vy = 0, vz = -8.5;
        if (prox.left < 2.2) vx = 6.0;
        if (prox.right < 2.2) vx = -6.0;
        if (prox.front < 3.0) vz = -3.5;
        return { vx, vy, vz };
    }
}`
    },

    6: {
        title: "關卡六：光流備援與視差避障 (Optical Flow)",
        badge: "終極極限：所有深度相機與雷達故障下的光流脫困",
        desc: "災難性考驗：深度相機崩潰、雷達失效、光達損壞！僅能依靠 api.get_optical_flow() 追蹤畫面特徵點的像素擴張速度，利用運動視差避開突發障礙。",
        todo: `class StudentController {
    get_velocity(state, api) {
        const flows = api.get_optical_flow(); // 取得視野特徵點像素流速
        let vx = 0, vy = 0, vz = -7.5;

        // 📝 TODO: 如果某個特徵點的像素流速 vx_px 過大且距離極近，立即反向閃避
        for (let f of flows) {
            if (f.speed_px > 45.0) {
                vx += (f.x_px < 88) ? 6.0 : -6.0;
                vz = -3.5;
            }
        }
        return { vx, vy, vz };
    }
}`,
        solution: `class StudentController {
    get_velocity(state, api) {
        const flows = api.get_optical_flow();
        let vx = 0, vy = 0, vz = -8.0;
        for (let f of flows) {
            if (f.speed_px > 35.0) {
                vx += (f.x_px < 88) ? 7.0 : -7.0;
                vz = -3.0;
            }
        }
        return { vx, vy, vz };
    }
}`
    }
};
