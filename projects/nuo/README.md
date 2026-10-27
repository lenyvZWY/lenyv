# 《傩 NUO》· 技术美术交付

UE 5.8 项目的画面优化成果（TA）。**只含技术文件，不含叙事正文**（STORY.md 里的三结局、情感核弹、终局诡计属于剧透，留在本地）。

| 文件 | 说明 |
|---|---|
| `TA_LOOKDEV.md` | 画面优化方案：曝光灰卡标定、灯光/体积雾/后处理数值表、Niagara 预算、附录 A 可直接粘贴的 C++ |
| `make_nuo_surface_v2.py` | 母材质 v2 生成脚本：湿润层 + 水洼 + 宏观色变 + 全局天气 MPC |
| `ta_mat_v2_report.txt` | 在 UE 5.8 实机跑出来的构建报告 |

## 一句话结论

画面现在「平」，不是资产差，是三个系统层没打通：**湿度、体积雾、曝光**。这三件事都是零资产成本。

## 实测

```
表达式节点数 = 75
BaseColor <- Multiply / Normal <- LinearInterpolate / Roughness <- LinearInterpolate
MPC_NuoWeather：RainWetness / PuddleLevel / WetDarkening / WetRoughness 全部连通
RESULT = OK，无着色器错误
```

## 怎么跑

编辑器必须先关闭（否则资产被占用）：

```bat
"E:\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "E:\Nuo\Nuo.uproject" ^
  -run=pythonscript -script="E:\Nuo\tools\make_nuo_surface_v2.py" -unattended -nosplash
```

结果写到 `E:\Nuo\Saved\ta_mat_v2_report.txt`。脚本可重复运行：第二次是原地清空重建，不会留下悬空父材质。

## 关键决策（为什么不那样做）

- **0 个 Static Switch**：单平台（PC / SM6），加开关只会让着色器排列翻倍。画质分档交给 MPC 参数。
- **湿度走 MPC 而不是逐材质**：湿是全场景的状态，不是资产属性。一行代码切雨势。
- **不加 Quality Switch**：低配把 `PuddleLevel` 调 0 比重编一套着色器便宜得多。
- **反射关着也能做湿感**：粗糙度塌到 0.06 后，直接光的高光会自然收紧；只有水洼的「照见东西」才需要 Lumen 反射，见方案 §3.4。
