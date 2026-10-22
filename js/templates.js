// js/templates.js
window.LAB_PARAMS = {
    steerGain: 0.20,      // L1 預設偏低(0.20)，讓學生體驗擦撞並調高至 0.65
    predictTime: 0.0,     // L2 預設不預判(0.0s)，讓學生體驗撞上動態飛鳥並調高至 1.5s
    maxSafeSlope: 5.0     // L3 安全降落最大允許坡度
};

window.LEVEL_DATA = {
    1: {
        title: "關卡一：雙目立體視覺相機 (Stereo Vision)",
        badge: "目標：穿越細電線抵達 Z = -135m",
        desc: "前方有傳統光達易漏檢的極細高壓電線與樹枝。請在 16×16 深度矩陣中找出最遠（最藍）的 4×4 安全視窗，並調整【TODO】區的轉向靈敏度與安全減速距離！",
        todo: `class StudentController {
    constructor() {
        this.step = 0;
    }

    get_velocity(state, api) {
        this.step++;
        const map = api.get_stereo_depth_map();

        // 1. 掃描 16x16 深度矩陣，尋找平均深度最遠(最藍)的 4x4 安全視窗
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

        // 在右上角 HUD 畫出找到的 4x4 白色安全視窗
        api.set_debug_window(bestR, bestC);

        // ==========================================================
        // 📝 【TODO 1-1】調整轉向靈敏度 (steerGain)
        // 目前預設讀取上方滑桿 LAB_PARAMS.steerGain (初始 0.20 太遲鈍會撞電線！)
        // 請拉動上方「L1 轉向靈敏度」滑桿到 0.65，或直接把下行改成 0.65！
        // ==========================================================
        const steerGain = window.LAB_PARAMS.steerGain; 

        let vx = ((bestC + 1.5) - 7.5) * steerGain;
        let vy = (7.5 - (bestR + 1.5)) * (steerGain * 0.75);

        // ==========================================================
        // 📝 【TODO 1-2】當前方視窗深度 maxDepth 小於 14 公尺時，請減速！
        // 請把 -9.5 改成較慢的速度（例如 -4.5），避免衝太快閃避不及
        // ==========================================================
        let vz = (maxDepth < 14.0) ? -4.5 : -9.0;

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
        let bestR = 6, bestC = 6, maxscore = -999;

        // 尋找最遠且盡量靠近畫面中央的 4x4 連通視窗
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
                const centerPenalty = Math.abs((c + 1.5) - 7.5) * 0.4 + Math.abs((r + 1.5) - 7.5) * 0.3;
                const score = (sum / 16.0) + minCell * 0.6 - centerPenalty;
                if (score > maxscore) {
                    maxscore = score;
                    bestR = r;
                    bestC = c;
                }
            }
        }
        api.set_debug_window(bestR, bestC);

        // 將視窗中心誤差轉為平滑橫向與垂直速度
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

        // 基本巡航：維持在跑道中央與 9m 高度前進
        let vx = -pos.x * 0.6;
        let vy = (9.0 - pos.y) * 1.2;
        let vz = -8.5;

        // ==========================================================
        // 📝 【TODO 2-1】設定雷達預判未來秒數 (predictSec)
        // 預設滑桿為 0.0 秒（只看現在位置，會跟橫向飛鳥撞上！）
        // 請把上方「L2 預判未來秒數」滑桿拉到 1.5s，或直接將下行改為 1.5
        // ==========================================================
        const predictSec = window.LAB_PARAMS.predictTime;

        for (let t of targets) {
            // 只關注前方 32 公尺內的動態目標
            if (t.z_rel < 0 && t.dist < 32.0) {
                // 核心公式：未來橫向位置 = 現在相對位置 + 相對橫向速度 * 預判秒數
                const futureX = t.x_rel + (t.rel_vx * predictSec);

                // 如果預判未來它會進入我們正前方走廊 (-5.5m ~ +5.5m)
                if (Math.abs(futureX) < 5.5) {
                    // ==================================================
                    // 📝 【TODO 2-2】決定閃避方向：
                    // 如果目標未來在偏右邊 (futureX > 0)，我們往左閃 (-7.5)，否則往右閃 (+7.5)
                    // ==================================================
                    vx += (futureX > 0) ? -7.5 : 7.5;
                    vy += (t.y_rel > 0) ? -2.5 : 2.5;
                    vz = -5.5; // 接近時減速
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
            if (t.z_rel < 0 && t.dist < 35.0) {
                const closingSpeed = Math.max(1.0, -t.rel_vz);
                const ttc = Math.min(2.2, Math.abs(t.z_rel) / closingSpeed);

                // 結合都卜勒相對速度預判未來軌跡
                const futureX = t.x_rel + t.rel_vx * ttc;
                const futureY = t.y_rel + t.rel_vy * ttc;

                if (Math.abs(futureX) < 5.8 && Math.abs(futureY) < 4.0) {
                    const evadeDir = (futureX >= 0) ? -1 : 1;
                    vx += evadeDir * 8.0;
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

        // 階段 1：尚未飛抵大樓屋頂前 (z > -126)，保持 12.5m 安全高度巡航
        if (pos.z > -126.0) {
            return {
                vx: -pos.x * 0.8,
                vy: (12.5 - pos.y) * 1.5,
                vz: -10.5
            };
        }

        // 階段 2：抵達屋頂上方！利用 ToF 導引向量 (pad_dx, pad_dz) 對準綠色停機坪
        let vx = tof.pad_dx * 1.8;
        let vz = tof.pad_dz * 1.8;
        let vy = (11.2 - pos.y) * 1.2; // 先懸停在屋頂上方 11.2m 掃描地形

        // ==========================================================
        // 📝 【TODO 3-1】設定安全降落條件：
        // 必須同時滿足：1. 已對準停機坪 (tof.over_pad) 且 2. 坡度小於安全門檻
        // ==========================================================
        const maxSlope = window.LAB_PARAMS.maxSafeSlope; // 預設 5.0 度
        const isSafeToLand = tof.over_pad && (tof.slope_deg < maxSlope) && tof.is_safe_landing_zone;

        if (isSafeToLand) {
            // 📝 【TODO 3-2】請把下面這行的 -0.2 改成 -2.2，讓無人機穩定降落觸地！
            vy = -0.2; 
        }

        return { vx, vy, vz };
    }
}`,
        solution: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const tof = api.get_downward_tof();

        // 階段 1：高速巡航接近屋頂
        if (pos.z > -126.0) {
            return { vx: -pos.x * 0.9, vy: (12.5 - pos.y) * 1.5, vz: -11.0 };
        }

        let vx = tof.pad_dx * 2.2;
        let vz = tof.pad_dz * 2.2;
        let vy = (11.5 - pos.y) * 1.2;

        // 🛡️ 防碰撞保護：如果下方剛好是水塔或斜坡 (slope_deg > 10 且還沒對準停機坪)，強制拉高並平移閃避
        if (tof.slope_deg > 10.0 && !tof.over_pad) {
            vy = 2.5; // 往上爬升避開水塔
            vx += (pos.x < 5.0) ? 3.0 : -3.0; // 側向推開
        }

        // 階段 3：確認停機坪中心且地形坡度平坦 (< 5 度)，執行精準緩降
        if (tof.over_pad && tof.slope_deg < 5.0 && tof.is_safe_landing_zone) {
            vx = tof.pad_dx * 1.2;
            vz = tof.pad_dz * 1.2;
            vy = (tof.agl < 2.0) ? -1.2 : -2.4;
        }

        return { vx, vy, vz, vy };
    }
}`
    },

    4: {
        title: "關卡四：多感測器融合 (Sensor Fusion) 綜合考驗",
        badge: "終極考驗：細電線 ➔ 局部濃霧機群 ➔ 複雜屋頂降落",
        desc: "前段為晴天高壓電線區，中段進入局部濃霧與動態飛鳥區，終點為複雜屋頂。請結合 api.get_stereo_quality() 自動切換雙目視覺、4D 雷達與下視 ToF！",
        todo: `class StudentController {
    get_velocity(state, api) {
        const pos = state.position;
        const quality = api.get_stereo_quality(); // 光學可靠度 (0~1，濃霧區會驟降)
        const tof = api.get_downward_tof();

        // 1. 終點屋頂階段 (Z <= -126m)：切換為下視 ToF 精準降落模式
        if (pos.z <= -126.0) {
            let vx = tof.pad_dx * 2.0;
            let vz = tof.pad_dz * 2.0;
            let vy = (11.2 - pos.y) * 1.2;
            if (tof.over_pad && tof.slope_deg < 5.0 && tof.is_safe_landing_zone) {
                vy = -2.2;
            }
            return { vx, vy, vz };
        }

        // 2. 巡航避障階段：融合雙目視覺與 4D 毫米波雷達
        const map = api.get_stereo_depth_map();
        let bestR = 6, bestC = 6, maxDepth = -1;
        for (let r = 2; r <= 10; r++) {
            for (let c = 1; c <= 11; c++) {
                let sum = 0;
                for (let dr = 0; dr < 4; dr++)
                    for (let dc = 0; dc < 4; dc++) sum += map[r + dr][c + dc];
                if (sum / 16 > maxDepth) { maxDepth = sum / 16; bestR = r; bestC = c; }
            }
        }
        api.set_debug_window(bestR, bestC);

        // 依據光學可靠度 quality 動態調整雙目視覺權重
        let vx = ((bestC + 1.5) - 7.5) * 0.68 * quality + (-pos.x * 0.35) * (1 - quality);
        let vy = (7.5 - (bestR + 1.5)) * 0.45 * quality + (9.5 - pos.y) * 1.0;
        let vz = -8.5;

        // 疊加 4D 雷達動態預判閃避 (不受濃霧影響)
        const targets = api.get_4d_radar_detections();
        for (let t of targets) {
            if (t.z_rel < 0 && t.dist < 32.0) {
                // 📝 【TODO 4-1】請確認雷達預判秒數 (建議 1.4 秒)
                const futureX = t.x_rel + t.rel_vx * 1.4;
                if (Math.abs(futureX) < 5.5) {
                    vx += (futureX >= 0) ? -7.5 : 7.5;
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
        const quality = api.get_stereo_quality();
        const tof = api.get_downward_tof();

        // 階段三：屋頂 ToF 導引與斜率檢查降落
        if (pos.z <= -126.0) {
            let vx = tof.pad_dx * 2.0;
            let vz = tof.pad_dz * 2.0;
            let vy = (11.0 - pos.y) * 1.2;
            if (tof.over_pad && tof.slope_deg < 5.0 && tof.is_safe_landing_zone) {
                vy = (tof.agl < 2.0) ? -1.2 : -2.4;
            }
            return { vx, vy, vz };
        }

        // 階段一 & 二：雙目視覺 + 4D 毫米波雷達自適應權重融合
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

        let vx = ((bestC + 1.5) - 7.5) * 0.72 * quality + (-pos.x * 0.4) * (1 - quality);
        let vy = (7.5 - (bestR + 1.5)) * 0.45 * quality + (9.5 - pos.y) * 1.1;
        let vz = -8.8;

        const targets = api.get_4d_radar_detections();
        for (let t of targets) {
            if (t.z_rel < 0 && t.dist < 34.0) {
                const ttc = Math.min(2.0, Math.abs(t.z_rel) / Math.max(1.0, -t.rel_vz));
                const futureX = t.x_rel + t.rel_vx * ttc;
                if (Math.abs(futureX) < 5.8) {
                    vx += (futureX >= 0) ? -8.0 : 8.0;
                    vz = -5.5;
                }
            }
        }
        return { vx, vy, vz };
    }
}`
    }
};
