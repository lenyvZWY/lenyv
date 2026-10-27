# 《傩 NUO》画面优化 · 技术美术方案 v1.0

> 一句话：**画面现在"平"，不是资产差，是三个系统层没打通——湿度、体积雾、曝光。**
> 这三件事都是零资产成本，改完立竿见影。资产（模型/贴图）反而是最后才该动的。

---

## 0. 我做了什么（本次已落地）

| 项 | 文件 | 状态 |
|---|---|---|
| 母材质 v2：湿润层 + 水洼 + 宏观色变 | `E:\Nuo\tools\make_nuo_surface_v2.py` | ✅ 已生成并编译通过 |
| 全局天气 MPC（5 参数，一个数控全场景湿度） | `/Game/Materials/MPC_NuoWeather` | ✅ 5 参数已写入 |
| 本方案（灯光/雾/后处理/Niagara 数值表） | 本文档 | — |
| 可直接粘贴的 C++（后处理 / 雾） | 附录 A | 待你贴 |

**实测结果**（`E:\Nuo\Saved\ta_mat_v2_report.txt`）：

```
表达式节点数 = 75
BaseColor <- Multiply        Normal <- LinearInterpolate
Roughness <- LinearInterpolate   Metallic <- Constant(0)
Scalar 参数  = Tiling / Wetness / MacroVariation
Texture 参数 = BaseColorTex / RoughnessTex / NormalTex
MPC 引用     = MPC_NuoWeather（RainWetness / PuddleLevel / WetDarkening / WetRoughness 全部连上）
RESULT = OK
```

> 5.8 里 `get_statistics` 已移除，指令数请在编辑器里用材质编辑器 Stats 面板读一次，填进 §3.3。

参数名向后兼容：`BaseColorTex / NormalTex / RoughnessTex / Tiling` 全部保留，
C++ 里已有的 `SetScalarParameterValue("Tiling", …)` 不用改一行。

---

## 1. 诊断（全部有据可依，不是感觉）

| # | 问题 | 证据 | 画面后果 | 收益/成本 |
|---|---|---|---|---|
| 1 | **材质是"干燥晴天"的 PBR** | `M_NuoSurface` 只有 BaseColor / Normal / Roughness 三通道 | 全片在下雨，但地面、木墙、石板全是哑光的。Lumen 抓不到任何高光，雨夜拍出来像阴天 | ★★★★★ / 1 天 |
| 2 | **曝光是拍脑袋的** | `NuoCharacter.cpp:84` `AutoExposureBias = 5.0`，注释写"2^4=16 倍"——实际 2^5=32 倍 | 暗部被强行提亮 → 灰、糊、色带；灯光强度被迫往大里调 → 高光死白 | ★★★★★ / 2 小时 |
| 3 | **只有高度雾，没有体积雾的"形"** | `NuoCharacter.cpp:98` `SetFogDensity(0.045)`；未显式开 Volumetric | 0.045 密度 ≈ 22m 处衰减到 1/e²，远景全糊成一片蓝灰；但**没有光柱**，暗部是"平的黑"不是"有厚度的黑" | ★★★★☆ / 半小时 |
| 4 | **后处理只有暗角+饱和+颗粒** | `NuoCharacter.cpp:78-86` | 缺对比、缺冷暖分离、缺 bloom 阈值控制 → 画面"没味道"，像没调色的 raw | ★★★★☆ / 2 小时 |
| 5 | **动态层缺失** | 无雨、无灯焰、无浮尘 | 静止画面 = 低模展览。恐怖游戏的"活"全在这些 0.1ms 的小系统上 | ★★★☆☆ / 1 天 |
| 6 | **反射关闭** | `DefaultEngine.ini:63` `r.Lumen.Reflections.Allow=0` | 水洼没有镜面反射，只剩高光点。见 §3.4 的分档建议 | ★★★☆☆ / 决策项 |

---

## 2. 曝光标定（先做这个，其余全部依赖它）

现在的问题：关了自动曝光，却没有标定基准，只能靠"看着差不多"调 Bias。
结果是为了看清暗部把 Bias 推到 5（32 倍），高光全部撞死，且不同场景亮度不一致。

**标定法（灰卡法，20 分钟，一次定死）：**

1. 场景里临时放一个球，材质用纯色 `RGB = (0.18, 0.18, 0.18)`（linear，即 18% 中灰）。
2. 放在**提灯正前方 3m**，人眼正常站位。
3. 后处理全部清零（Grade / Bloom / Vignette / Grain 全关）。
4. 截图取这个球的像素值，目标是 **sRGB 112–124**（对应 linear 0.16–0.20）。
5. 调 `AutoExposureBias` 逼近这个值，记下来 —— 这就是本作的**基准曝光**。
6. 拿掉球，把后处理加回来。

**预期结果**：Bias 会从 5.0 掉到 **2.5–3.5** 区间。
这意味着灯光强度可以物理化（下面的表），暗部不再是"提亮的灰"，而是"深但有层次"。

> ⚠️ 顺手修注释：`AutoExposureBias` 单位是 **EV 档**，每 +1 = ×2。
> 现注释"2^4=16 倍"与代码 5.0（32 倍）不符，会误导后来人。

**曝光与色温的硬规则（写进规范，不许破）：**

| 光源 | 色温 | 作用 | 备注 |
|---|---|---|---|
| 提灯 / 蜡烛 | 2400–2800 K | 主光（Key） | 唯一投影光源 |
| 月光 | 6000–7000 K | 轮廓光（Rim）/ 环境底 | **永不作为主光**（红线⑨：光即资源） |
| 纸扎铺 / 祠堂漏光 | 3200 K | 点缀 | 用来诱导玩家走向 |
| 阴物自发 | 4800 K 偏青 | 恐怖提示 | 只做边缘，不做面光 |

---

## 3. 材质层

### 3.1 母材质 v2 做了什么

```
M_NuoSurface（唯一母材质，全部变化走 Material Instance）
├─ Tiling              UV 平铺（原有）
├─ Wetness             本材质的基础湿度（0..1）
├─ MacroVariation      宏观色变强度（默认 0.15，打散 1K 贴图重复）
├─ MPC_NuoWeather ←── 全局天气（蓝图/代码改一个数，全场景响应）
│   ├─ RainWetness     总湿度闸门
│   ├─ PuddleLevel     水洼覆盖比例
│   ├─ WetDarkening    湿表面反照率乘数
│   ├─ WetRoughness    水膜粗糙度
│   └─ RainIntensity   给雨丝/涟漪用
└─ 物理链路
    BaseColor  → lerp(原色, 原色×WetDarkening, Wet) × MacroVariation
    Normal     → lerp(原法线, 世界向上, 水洼×0.85)     ← 水面把微表面抹平
    Roughness  → lerp(原粗糙, WetRoughness, Wet) → lerp(…, 0.02, 水洼)
```

**为什么这么做（而不是给每个材质单独加湿润）：**
湿是全场景的**状态**，不是资产属性。做成 MPC 之后，
"雨变大 / 玩家进祠堂收伞 / 第三幕雨停" —— 一行代码，零材质改动。

用法（任意蓝图）：
```
UKismetMaterialLibrary::SetScalarParameterValue(this, MPC_NuoWeather, "RainWetness", 0.95f);
```

### 3.2 每类材质的 Wetness（默认 1.0 = 全湿，室内物件要压）

| 材质 | Wetness | 理由 |
|---|---|---|
| 地面石板 / 木地板 / 泥墙 | 1.0 | 露天的，全湿 |
| 木头梁柱 / 木板 | 0.8 | 淋了但没泡水 |
| 布料（寿衣、幡） | 0.35 | 吸水但不反光；**反照率要压暗，粗糙度别压** |
| 纸扎 / 纸人 | 0.15 | 纸淋湿会烂，不能有高光，只能脏 |
| 傩面（漆面） | 0.5 | 漆本身有清漆反射，另建 `M_NuoMask` 处理（见 §3.4） |

### 3.3 成本

| 指标 | 数值 | 预算 | 判定 |
|---|---|---|---|
| 纹理采样 | 3（Base/Normal/Rough）+ 2（程序化噪声） | < 16 | ✅ |
| Static Switch | **0** | 每加 1 个排列翻倍 | ✅ 故意不加 |
| 指令数 | 脚本自动打印（`get_statistics`） | < 400（console 档） | 待填 |

> **不加 Quality Switch 的理由**：本作单平台（PC / SM6）。
> 画质分档交给 MPC 参数（低配把 PuddleLevel 调 0 即可，比多一套着色器便宜得多）。
> 这是纪律，不是偷懒。

### 3.4 关于反射（`r.Lumen.Reflections.Allow=0`）

湿感**不完全依赖反射**：粗糙度塌到 0.06 后，直接光的高光会自然收紧成湿润的"亮斑"，
这条链路不花任何反射成本。所以关掉反射，湿润层照样成立。

但**水洼的"照见东西"必须有反射**。建议：

| 画质档 | Lumen 反射 | 水洼表现 |
|---|---|---|
| 性能 / 均衡 | 关（现状） | PuddleLevel ≤ 0.3，只做暗色高光斑 |
| 画质 | `r.Lumen.Reflections.Allow=1`，`r.Lumen.Reflections.DownsampleFactor=2` | PuddleLevel 0.6，能照见灯笼 |
| 电影 | 开 + 硬件光追 | 全量 |

把 `r.Lumen.Reflections.Allow` 从 ini 挪到 `Nuo.Quality` 的切换逻辑里，不要写死在启动配置。

---

## 4. 灯光规范

### 4.1 单灯原则（本作的命）

> 一个画面里**只有一盏灯有阴影** —— 距离玩家最近的那盏。
> 其余全部关 `Cast Shadows`，靠 Lumen 的间接光填。

理由：虚拟阴影已关（`r.Shadow.Virtual.Enable=0`），普通 CSM 每盏投影灯都是独立 pass。
八盏灯笼全投影 = 八次阴影渲染，帧率直接腰斩，而玩家根本分辨不出第五盏灯笼的影子。

### 4.2 参数表（建议值，标定后微调）

| 灯 | 组件 | 现值 | 建议 | 说明 |
|---|---|---|---|---|
| 提灯 | SpotLight | 2600 lm | **1400–1800 lm** | 内锥 24° / 外锥 42°，衰减 1.2，体积散射 0.35（保持） |
| 灯笼 | PointLight | 300 lm | **450–700 lm**，半径 500 | 只最近 1 盏投影 |
| 月光 | DirectionalLight | 0.035 lux | **0.25–0.5 lux**，色 (0.55,0.68,0.90) | 只做轮廓，不做照明 |
| 天光 | SkyLight | — | 强度 0.10，`LowerHemisphere` 全黑 | 给暗部一点点方向，别让阴影变纯黑 |
| 高度雾 | ExponentialHeightFog | 0.045 | **室外 0.022 / 祠堂内 0.038** | 配合 `FogHeightFalloff = 0.2` |

### 4.3 体积雾必须"有形"

现在只设了密度和散射色，雾是均匀的一坨。要出神光（god ray），必须：

```
bEnableVolumetricFog          = true
VolumetricFogScatteringDistribution = 0.6     // 前向散射，光柱更明显
VolumetricFogExtinctionScale  = 1.0
VolumetricFogAlbedo           = (0.72, 0.78, 0.90)   // 冷灰蓝，不是纯白
```

配合"门缝光"：祠堂门缝塞一支**很窄的 SpotLight**（外锥 12°，强度 800 lm，不投影），
穿过雾就是一道光柱。这一支灯的画面贡献，比加十盏灯笼都大。

---

## 5. Niagara（按预算建，不是按好看建）

| 系统 | 模拟 | 峰值粒子 | GPU 预算 | 关键参数 |
|---|---|---|---|---|
| **NS_Rain** | GPU | 12000 | 0.6 ms | 圆柱发射器半径 15m 跟随相机；速度 900–1200 cm/s；**用 Ribbon 不用 Sprite**（细长雨丝）；`Max Particle Count = 12000` 硬顶 |
| **NS_LanternFlame** | CPU | 12 | 0.08 ms | 3 层 Sprite（芯/焰/烟）不同寿命；配合代码已有的 300±30 流明闪烁 |
| **NS_DustMotes** | GPU | 800 | 0.15 ms | 只在体积雾内可见（用 Depth 判断），速度 2–5 cm/s，几乎不动才对 |
| **NS_FootstepSplash** | CPU | 14 / burst | 0.05 ms | 踩水才触发；`Surface Type` 判定；水中要**涟漪**（Decal）而不是水花 |
| **NS_SpiritDissolve** | 材质 | — | 0 ms | 阴物"显形"用材质 Dissolve + 边缘自发光，不用粒子 |

**三条铁律：**
1. 每个系统必须设 `Max Particle Count` —— 永远不设无限。
2. 雨必须做 Low/Medium/High 三档（8000 / 12000 / 16000），低配直接砍粒子不砍分辨率。
3. 阴物同时在场 ≤ 8（与 GRAPHICS.md 的半透明预算对齐）。

---

## 6. 后处理栈（按这个顺序调，别乱试）

在现有 `PostProcessVolume`（`NuoCharacter.cpp:75`）上补：

| 项 | 参数 | 建议值 | 为什么 |
|---|---|---|---|
| Exposure | AutoExposureBias | 见 §2 标定 | 一切的前提 |
| Bloom | Intensity / Threshold | 0.55 / 0.85 | 阈值抬高，只让灯火与月光溢出，别让整片雾发白 |
| Bloom | Method | Standard（非 Convolution） | 省 1ms，本作不需要高质量 bloom |
| Color Grading | Global Saturation | (0.85, 0.85, 0.92) | 整体去饱和，蓝通道留一点 → 阴冷 |
| Color Grading | Shadows（Lift） | (0.96, 1.00, 1.06) | 暗部推青，**这是"中式恐怖"的味** |
| Color Grading | Highlights（Gain） | (1.04, 1.00, 0.94) | 高光推暖，与暗部青形成色温对撞 |
| Color Grading | Contrast | 1.08 | 轻微提对比，别过 1.15（暗部会死） |
| Vignette | Intensity | 0.42 | 现有值未知，别超过 0.6 |
| Film Grain | Intensity / Jitter | 0.18 / 0.6 | 掩盖 TSR 77% 的软，同时给"胶片"质感 |
| Chromatic Aberration | Max | 0.12 | 只在边缘，超过 0.2 会晕 |
| DOF | F-stop / Focal Distance | 2.8 / 350 | **只在过场与对话开**；探索时关（省 1ms 且玩家要看路） |
| Motion Blur | — | 关（现状） | 对 |

---

## 7. 镜头层（零成本，收益极高）

| 项 | 值 | 说明 |
|---|---|---|
| FOV | 75 | 恐怖游戏 70–80；比 90 更压迫，也省边角像素 |
| 手持微晃 | 0.3° 柏林噪声，频率 0.4 Hz | 代码 5 行；静止时画面也不"死" |
| 呼吸 | 0.15° 正弦，频率 0.25 Hz | 叠加在手持上，紧张时频率 ×2 |
| 戴面瞬间 | FOV 75 → 68，200ms 缓动 | 面具压迫感，纯相机参数 |

---

## 8. 验收（可量化，不许"看着还行"）

- [ ] 灰卡标定：提灯 3m 处中灰球 sRGB 112–124
- [ ] 母材质 Shader 指令数 < 400，纹理采样 ≤ 6（脚本会打印）
- [ ] 1080p 均衡档，祠堂前院 ≥ 60 FPS，1% Low ≥ 50（现有标准）
- [ ] 全场景同屏投影灯 ≤ 1 盏
- [ ] 暗部无色带（Grain 0.18 + TSR 抖动可解）
- [ ] 雨在低档 8000 粒子下不掉帧（`stat unit` GPU < 16.6ms）
- [ ] 切 `RainWetness` 0→1，全场景材质在 1 帧内响应（MPC 生效验证）

---

## 9. 下一步（按顺序做，别并行）

1. **跑一次曝光标定**（§2）—— 不做这个，后面全是白调。
2. **验证材质 v2**：`verify_material.py` 看连线，进游戏看地面有没有高光收紧。
3. **开体积雾 + 门缝光**（§4.3）—— 单点收益最大的一步。
4. **补后处理 Grade**（§6）—— 半天，画面立刻"有味道"。
5. **再做 Niagara 雨**（§5）—— 最后做，因为它依赖前四步的氛围才好看。

---

## 附录 A · 可直接粘贴的 C++

### A.1 后处理分级（替换 `NuoCharacter.cpp` 里 `S.AutoExposureBias = 5.0f;` 附近）

> ⚠️ **必须先做完 §2 灰卡标定再贴**，否则只是把"灰"调得更灰。
> `AutoExposureBias` 用标定值替换下面的占位。

```cpp
// ---- 曝光：灰卡标定值（原 5.0 = 32 倍，过度提亮导致高光撞死）----
S.bOverride_AutoExposureBias = true;
S.AutoExposureBias = 3.0f;              // ← 替换成 §2 标定出来的值

// ---- 分级：暗部推青、高光推暖，这是"中式恐怖"的味 ----
S.bOverride_ColorSaturation = true;
S.ColorSaturation = FVector4(0.85f, 0.85f, 0.92f, 1.0f);
S.bOverride_ColorContrast   = true;
S.ColorContrast   = FVector4(1.08f, 1.08f, 1.06f, 1.0f);
S.bOverride_ColorGain       = true;     // 高光（乘）
S.ColorGain       = FVector4(1.04f, 1.00f, 0.94f, 1.0f);
S.bOverride_ColorOffset     = true;     // 暗部（加）
S.ColorOffset     = FVector4(-0.004f, 0.0f, 0.006f, 0.0f);

// ---- Bloom：阈值抬高，只让灯火/月光溢出，不让整片雾发白 ----
S.bOverride_BloomIntensity = true;  S.BloomIntensity = 0.55f;
S.bOverride_BloomThreshold = true;  S.BloomThreshold = 0.85f;

// ---- 镜头层 ----
S.bOverride_VignetteIntensity    = true;  S.VignetteIntensity    = 0.42f;
S.bOverride_FilmGrainIntensity   = true;  S.FilmGrainIntensity   = 0.18f;
S.bOverride_FilmGrainTexelSize   = true;  S.FilmGrainTexelSize   = 1.6f;
S.bOverride_SceneFringeIntensity = true;  S.SceneFringeIntensity = 0.12f;
```

### A.2 体积雾（替换 `NuoCharacter.cpp:98` 那三行）

```cpp
if (auto* Fog = HeightFog->GetComponent())
{
    Fog->SetFogDensity(0.022f);                    // 原 0.045 → 22m 外全糊
    Fog->SetFogHeightFalloff(0.2f);                // 雾贴着地面，不糊天
    Fog->SetFogInscatteringColor(FLinearColor(0.05f, 0.07f, 0.11f));
    Fog->SetVolumetricFog(true);                   // ← 没有这行就没有光柱
    Fog->SetVolumetricFogScatteringDistribution(0.6f);  // 前向散射，光柱才明显
    Fog->SetVolumetricFogExtinctionScale(1.0f);
}
```

### A.3 天气总闸（任意蓝图 / 代码，一行切雨势）

```cpp
#include "Kismet/KismetMaterialLibrary.h"

UMaterialParameterCollection* Weather =
    LoadObject<UMaterialParameterCollection>(nullptr,
        TEXT("/Game/Materials/MPC_NuoWeather.MPC_NuoWeather"));

UKismetMaterialLibrary::SetScalarParameterValue(this, Weather, TEXT("RainWetness"), 0.95f);
UKismetMaterialLibrary::SetScalarParameterValue(this, Weather, TEXT("PuddleLevel"), 0.55f);
```

雨停 / 进祠堂收伞：`RainWetness → 0.15`，全场景材质 1 帧内变干，零材质改动。

---

## 附录 B · 已知限制

| 限制 | 影响 | 处理 |
|---|---|---|
| `r.Lumen.Reflections.Allow=0` | 水洼没有镜面倒影，只有高光斑 | 均衡档把 `PuddleLevel` 压到 ≤0.3；画质档开反射（§3.4） |
| 噪声是屏幕/UV 空间，非世界空间 | 相邻网格的宏观色变不连续 | 当前只用于打散单网格内平铺，可接受；要世界连续得换 WorldPosition（多 1 次节点） |
| 5.8 无 `get_statistics` | 拿不到指令数 | 编辑器材质 Stats 面板人工读一次，填 §3.3 |

---

*本文档与 GRAPHICS.md 互补：GRAPHICS.md 管"跑得动"，本文管"好不好看"。*

