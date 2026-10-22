// js/templates.js
window.LAB_PARAMS = {
    steerGain: 0.20,      // L1 預設偏低(0.20)，調高至 0.65 即可過關
    predictTime: 0.0,     // L2 預設不預判(0.0s)，調高至 1.5s 即可過關
    maxSafeSlope: 5.0     // L3 安全降落最大允許坡度
};

window.LEVEL_DATA = {
    1: {
        title: "關卡一：雙目立體視覺相機 (Stereo Vision)",
        badge: "目標：穿越細電線抵達 Z = -135m",
        desc: "前方有極細高壓電線與樹幹。請在 16×16 深度矩陣中找出最遠（最藍）的 4×4 安全視窗，並將【TODO 1-1】的轉向靈敏度調高（或拉動上方 L1 滑桿至 0.65）！",
        todo: `class StudentController {
    get_velocity(state, api) {
        const map = api.get_stereo_depth_map();

        // 1. 掃描 16x16 深度矩陣，尋找最遠(最藍)的 4x4 安全視窗
        let bestR = 6, bestC = 6, maxDepth = -1;
        for (let r = 2; r <= 10; r++) {
            for (let c = 1; c <= 11; c++) {
                let sum = 0;
                for (let dr = 0; dr < 4; dr++) {
                    for (let dc = 0; dc < 4; dc++) {
                        sum += map[r + dr][c + dc];
                    }
                }
                let avg = sum / 16.0;
                if (avg > maxDepth) {
                    maxDepth = avg;
                    bestR = r;
                    bestC = c;
                }
            }
        }
        api.set_debug_window(bestR, bestC);

        // 📝 【TODO 1-1】目前預設讀取上方滑桿 (0.20 太遲鈍會撞電線)
        // 請拉動上方「L1 轉向靈敏度」滑桿至 0.65，或直接把下行改為 0.65！
        const steerGain = window.LAB_PARAMS.steerGain;

        let vx = ((bestC + 1.5) - 7.5) * steerGain;
        let vy = (7.5 - (bestR + 1.5)) * (steerGain * 0.75);
        let vz = (maxDepth < 14.0) ? -5.0 : -9.0;

        return { vx, vy, vz };
    }
}`,
        solution: `class StudentController {
    constructor() {
        this.smoothVx = 0;
        this.smoothVy = 0;
    }
    get_velocity(state, api) {
        const map = api.get_stereo_depth_map();
        let bestR = 6, bestC = 6, maxScore = -999;

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
                const centerPenalty = Math.abs((c + 1.5) - 7.5) * 0.35 + Math.abs((r + 1.5) - 7.5) * 0.25;
                const score = (sum / 16.0) + minCell * 0.65 - centerPenalty;
                if (score > maxScore) {
                    maxScore = score;
                    bestR = r;
                    bestC = c;
                }
            }
        }
        api.set_debug_window(bestR, bestC);

        const targetVx = ((bestC + 1.5) - 7.5) * 0.75;
        const targetVy = (7.5 - (bestR + 1.5)) * 0.52 + (8.5 - state.position.y) * 0.4;
        this.smoothVx = this.smoothVx * 0.55 + targetVx * 0.45;
        this.smoothVy = this.smoothVy * 0.55 + targetVy * 0.45;

        return { vx: this.smoothVx, vy: this.smoothVy, vz: -8.8 };
    }
}`
    },

    2: {
        title: "關卡二：4D 毫米波雷達 (4D mmWave Radar)",
        badge: "目標：濃霧中預判動態飛鳥抵達 Z = -135m",
        desc: "濃霧暴雨下光學雙目相機已失效！請利用 4D 毫米波雷達回傳的「都卜勒相對速度 (rel_vx)」，將【TODO 2-1】的預判秒數調高至 1.5 秒提前閃避！",
        todo: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const targets = api.get_4d_radar_detections();

        let vx = -pos.x * 0.6;
        let vy = (9.0 - pos.y) * 1.2;
        let vz = -8.5;

        // 📝 【TODO 2-1】預設滑桿為 0.0 秒（只看現在位置，會跟橫向飛鳥撞上！）
        // 請把上方「L2 預判秒數」滑桿拉到 1.5s，或直接將下行改為 1.5
        const predictSec = window.LAB_PARAMS.predictTime;

        for (let t of targets) {
            if (t.z_rel < 0 && t.dist < 32.0) {
                const futureX = t.x_rel + (t.rel_vx * predictSec);
                if (Math.abs(futureX) < 5.5) {
                    vx += (futureX >= 0) ? -7.5 : 7.5;
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

        let vx = -pos.x * 0.55;
        let vy = (9.0 - pos.y) * 1.2;
        let vz = -9.0;

        for (let t of targets) {
            if (t.z_rel < 0 && t.dist < 34.0) {
                const closingSpeed = Math.max(1.0, -t.rel_vz);
                const ttc = Math.min(2.0, Math.abs(t.z_rel) / closingSpeed);
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
        badge: "目標：避開屋頂水塔與斜坡，精準降落於綠色停機坪",
        desc: "終點大樓屋頂有兩座高聳水塔與 18° 斜坡屋頂。請維持 13.5m 安全高度飛過水塔上方，對準停機坪後將【TODO 3-1】的下降速度改為 -2.2 完成降落！",
        todo: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const tof = api.get_downward_tof();

        // 階段 1：尚未飛抵大樓屋頂前 (z > -126)，保持 13.5m 高度飛越水塔
        if (pos.z > -126.0) {
            return {
                vx: (5.2 - pos.x) * 0.6,
                vy: (13.5 - pos.y) * 1.5,
                vz: -10.5
            };
        }

        // 階段 2：利用 ToF 導引向量 (pad_dx, pad_dz) 對準綠色停機坪
        let vx = tof.pad_dx * 1.8;
        let vz = tof.pad_dz * 1.8;
        let vy = (12.8 - pos.y) * 1.2;

        // 若下方偵測到水塔或斜坡 (slope_deg > 10)，立即拉高避開
        if (tof.slope_deg > 10.0 && !tof.over_pad) {
            vy = 3.0;
        }

        const maxSlope = window.LAB_PARAMS.maxSafeSlope;
        if (tof.over_pad && tof.slope_deg < maxSlope && tof.is_safe_landing_zone) {
            // 📝 【TODO 3-1】請把下面這行的 -0.2 改成 -2.2，讓無人機穩定降落觸地！
            vy = -0.2;
        }

        return { vx, vy, vz };
    }
}`,
        solution: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const tof = api.get_downward_tof();

        // 巡航階段直接保持 13.8m 安全高度（高於 11.6m 水塔頂部）並對準停機坪 X 走廊
        if (pos.z > -126.0) {
            return {
                vx: (5.2 - pos.x) * 0.8,
                vy: (13.8 - pos.y) * 1.5,
                vz: -11.0
            };
        }

        const distPad = Math.hypot(tof.pad_dx, tof.pad_dz);
        let vx = Math.max(-6, Math.min(6, tof.pad_dx * 2.0));
        let vz = Math.max(-6, Math.min(6, tof.pad_dz * 2.0));
        let vy = (12.8 - pos.y) * 1.5;

        // 當水平對準停機坪中心且坡度平坦 (< 5°)，執行平滑降落
        if (distPad < 2.2 && tof.over_pad && tof.slope_deg < 5.0 && tof.is_safe_landing_zone) {
            vx = tof.pad_dx * 1.5;
            vz = tof.pad_dz * 1.5;
            vy = (tof.agl < 2.0) ? -1.2 : -2.5;
        }

        return { vx, vy, vz };
    }
}`
    },

    4: {
        title: "關卡四：3D 光達點雲 (LiDAR) 與多感測器融合",
        badge: "目標：濃霧中靠 3D 光達抓出「靜止柱體」並降落屋頂",
        desc: "都卜勒雷達看不見靜止柱體，濃霧又讓雙目相機充滿雜訊！請使用 api.get_lidar_scan() 讀取 15 道主動雷射距離，將【TODO 4-1】的排斥力道由 0.8 改為 5.5！",
        todo: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const tof = api.get_downward_tof();

        // 終點屋頂階段：使用下視 ToF 降落
        if (pos.z <= -126.0) {
            let vx = tof.pad_dx * 2.0, vz = tof.pad_dz * 2.0, vy = (12.8 - pos.y) * 1.2;
            if (tof.over_pad && tof.slope_deg < 5.0 && tof.is_safe_landing_zone) vy = -2.4;
            return { vx, vy, vz };
        }

        let vx = -pos.x * 0.4;
        let vy = (9.5 - pos.y) * 1.2;
        let vz = -8.5;

        // 1. 讀取 3D 光達 15 道扇形雷射點雲 (不受濃霧影響，專抓靜止柱體！)
        const lidar = api.get_lidar_scan();
        for (let ray of lidar) {
            if (ray.distance < 15.0 && Math.abs(ray.angle_deg) < 40) {
                // 📝 【TODO 4-1】目前排斥力道 0.8 太弱會撞上靜止紫色柱子！請改為 5.5
                const pushStrength = 0.8;
                vx += (ray.angle_deg <= 0 ? 1 : -1) * pushStrength * (1 - ray.distance / 15.0);
                vz = -5.5;
            }
        }

        // 2. 結合 4D 雷達閃避動態飛鳥
        for (let t of api.get_4d_radar_detections()) {
            if (t.z_rel < 0 && t.dist < 30.0) {
                const futureX = t.x_rel + t.rel_vx * 1.4;
                if (Math.abs(futureX) < 5.2) vx += (futureX >= 0) ? -7.0 : 7.0;
            }
        }
        return { vx, vy, vz };
    }
}`,
        solution: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const quality = api.get_stereo_quality();
        const tof = api.get_downward_tof();

        // 階段三：屋頂安全高度進場與 ToF 降落
        if (pos.z <= -122.0) {
            let vx = Math.max(-6, Math.min(6, tof.pad_dx * 2.0));
            let vz = Math.max(-6, Math.min(6, tof.pad_dz * 2.0));
            let vy = (13.2 - pos.y) * 1.5;
            if (tof.over_pad && tof.slope_deg < 5.0 && tof.is_safe_landing_zone) {
                vy = (tof.agl < 2.0) ? -1.2 : -2.5;
            }
            return { vx, vy, vz };
        }

        // 1. 晴天區：雙目立體視覺尋路 (閃避高壓細電線)
        const map = api.get_stereo_depth_map();
        let bestR = 6, bestC = 6, bestScore = -999;
        for (let r = 2; r <= 10; r++) {
            for (let c = 1; c <= 11; c++) {
                let sum = 0;
                for (let dr = 0; dr < 4; dr++)
                    for (let dc = 0; dc < 4; dc++) sum += map[r + dr][c + dc];
                const score = (sum / 16.0) - Math.abs((c + 1.5) - 7.5) * 0.35;
                if (score > bestScore) { bestScore = score; bestR = r; bestC = c; }
            }
        }
        api.set_debug_window(bestR, bestC);

        let vx = ((bestC + 1.5) - 7.5) * 0.70 * quality + (-pos.x * 0.35) * (1 - quality);
        let vy = (7.5 - (bestR + 1.5)) * 0.50 * quality + (10.2 - pos.y) * 1.2 * (1 - quality);
        let vz = -8.5;

        // 2. 3D 主動光達點雲掃描：即時偵測並繞開靜止柱體 (完全不依賴事先地圖！)
        const lidar = api.get_lidar_scan();
        let lidarPushX = 0;
        let minFrontDist = 35.0;
        for (let ray of lidar) {
            if (ray.distance < 16.0 && Math.abs(ray.angle_deg) < 42) {
                if (ray.distance < minFrontDist) minFrontDist = ray.distance;
                const weight = Math.pow((16.0 - ray.distance) / 16.0, 1.3);
                // 射線在左邊(angle <= 0)打中柱子則往右推(+)，反之往左推(-)
                lidarPushX += (ray.angle_deg <= 0 ? 1 : -1) * weight * 6.2;
            }
        }
        vx += lidarPushX;
        if (minFrontDist < 12.0) vz = -5.0;

        // 3. 4D 毫米波雷達：預判並閃避濃霧中的動態飛鳥
        const targets = api.get_4d_radar_detections();
        for (let t of targets) {
            if (t.z_rel < 0 && t.dist < 30.0) {
                const ttc = Math.min(1.8, Math.abs(t.z_rel) / Math.max(1.0, -t.rel_vz));
                const futureX = t.x_rel + t.rel_vx * ttc;
                if (Math.abs(futureX) < 5.0) {
                    vx += (futureX >= 0) ? -7.0 : 7.0;
                    vz = -5.5;
                }
            }
        }

        return { vx, vy, vz };
    }
}`
    },

    5: {
        title: "關卡五：四周近距防撞陣列 (Proximity / Sonar Array)",
        badge: "目標：在峽谷強側風中依靠四向超音波防撞抵達 Z = -135m",
        desc: "狹窄的都會高樓夾縫中有強烈亂流側風不斷將無人機推向牆壁！請使用 api.get_proximity() 監控左右牆面距離，將【TODO 5-1】的安全觸發距離調大至 3.8 公尺！",
        todo: `class StudentController {
    get_velocity(state, api) {
        const prox = api.get_proximity(); // 回傳 { front, left, right, back } 實際測距
        let vx = 0;
        let vy = (8.5 - state.position.y) * 1.2;
        let vz = -9.0;

        // 📝 【TODO 5-1】目前安全警戒距離設為 1.2m 太晚了，強側風會把飛機吹撞牆！
        // 請將 1.2 改為 3.8（當距離牆壁小於 3.8m 就提前出力反彈）
        const safeMargin = 1.2;

        if (prox.left < safeMargin) {
            vx += (safeMargin - prox.left) * 4.5; // 左側太近，向右反彈
        }
        if (prox.right < safeMargin) {
            vx -= (safeMargin - prox.right) * 4.5; // 右側太近，向左反彈
        }
        if (prox.front < 8.0) {
            vx += (prox.left > prox.right) ? -7.0 : 7.0; // 正前方有障礙，往較寬敞的一側閃
            vz = -4.5;
        }

        return { vx, vy, vz };
    }
}`,
        solution: `class StudentController {
    get_velocity(state, api) {
        const prox = api.get_proximity();
        let vx = (prox.right - prox.left) * 1.2; // 自動保持在左右牆壁正中間
        let vy = (8.5 - state.position.y) * 1.5;
        let vz = -9.2;

        const safeMargin = 4.2;
        if (prox.left < safeMargin) {
            vx += (safeMargin - prox.left) * 5.0;
        }
        if (prox.right < safeMargin) {
            vx -= (safeMargin - prox.right) * 5.0;
        }
        if (prox.front < 10.5) {
            vx += (prox.left > prox.right) ? -8.5 : 8.5;
            vz = -4.5;
        }

        return { vx, vy, vz };
    }
}`
    },

    6: {
        title: "關卡六：單眼迴旋光流與視差避障 (Optical Flow Fallback)",
        badge: "終極考驗：所有主動測距離線，靠單眼像素流速抵達 Z = -135m",
        desc: "所有深度相機、雷達與光達全數離線！僅能依靠 api.get_optical_flow() 追蹤視野中物體的「像素膨脹與橫移速度 (expansion_rate)」。請將【TODO 6-1】警戒門檻由 95 降為 26！",
        todo: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const flows = api.get_optical_flow(); // 回傳特徵點在畫面上的像素位置與膨脹速率

        let vx = -pos.x * 0.4;
        let vy = (8.5 - pos.y) * 1.2;
        let vz = -8.5;

        // 📝 【TODO 6-1】離我們越近的障礙物，畫面像素膨脹與移動速度 (flow_magnitude) 越快！
        // 目前門檻 95.0 太高（要貼到柱子臉上才反應），請改為 26.0 提早閃避！
        const dangerFlowThreshold = 95.0;

        for (let f of flows) {
            if (f.flow_magnitude > dangerFlowThreshold && Math.abs(f.screen_x) < 0.65) {
                // 特徵點在畫面偏右 (screen_x > 0) 代表障礙物在右前方，立即往左閃 (-8.0)
                vx += (f.screen_x >= 0) ? -8.0 : 8.0;
                vz = -5.0;
            }
        }

        return { vx, vy, vz };
    }
}`,
        solution: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const flows = api.get_optical_flow();

        let vx = -pos.x * 0.45;
        let vy = (8.5 - pos.y) * 1.5;
        let vz = -9.0;

        for (let f of flows) {
            // 利用運動視差：當特徵點像素流速與膨脹率超過 22 px/s 且位於視野中央走廊時反向閃避
            if (f.flow_magnitude > 22.0 && Math.abs(f.screen_x) < 0.72) {
                const weight = Math.min(2.0, f.flow_magnitude / 25.0);
                vx += (f.screen_x >= 0 ? -1 : 1) * 7.2 * weight;
                vz = -5.5;
            }
        }

        return { vx, vy, vz };
    }
}`
    }
};
