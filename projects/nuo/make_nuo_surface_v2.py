# 傩 NUO — 母材质 v2：给「雨夜」加湿润层（TA 优化）
#
# 为什么改：
#   旧 M_NuoSurface 只有 BaseColor/Normal/Roughness 三个采样，是"干燥晴天"的 PBR。
#   但本作 100% 场景在下雨：地面、木墙、石板、布料全湿。湿了的表面有两个物理变化
#     (1) 反照率变暗、饱和度升高（水膜吸收）
#     (2) 粗糙度塌陷到 0.02~0.08（水膜填平微表面 → 出现反射高光）
#   没有这两条，Lumen 的反射在画面里"抓不住东西"，雨夜看起来像干燥的阴天。
#
# 做法（关键决策）：
#   - 全局天气用 Material Parameter Collection（MPC_NuoWeather）驱动，
#     蓝图/代码改一个数就能让"全场景"从毛毛雨切到暴雨 —— 不需要动任何材质实例。
#   - 水洼掩码用 Noise 节点（程序化，不占纹理采样），便宜。
#   - 宏观色变（Macro Variation）打散 1K 贴图的重复感，同样用 Noise，零采样成本。
#   - 不加任何 Static Switch：本项目只有 PC 一个平台档位，
#     加开关 = 着色器排列翻倍 = 白等编译时间。画质分档交给 MPC 参数。
#
# 运行（编辑器必须关闭，否则资产被占用）：
#   "E:\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" ^
#     "E:\Nuo\Nuo.uproject" -run=pythonscript ^
#     -script="E:\Nuo\tools\make_nuo_surface_v2.py" -unattended -nosplash

import unreal

MAT_PATH = "/Game/Materials/M_NuoSurface"
MPC_PATH = "/Game/Materials/MPC_NuoWeather"

mel = unreal.MaterialEditingLibrary
EAL = unreal.EditorAssetLibrary

# 命令行模式下 unreal.log 不回显到 stdout，一律写文件，省得瞎猜
REPORT = "E:/Nuo/Saved/ta_mat_v2_report.txt"
_LINES = []


def _flush():
    try:
        with open(REPORT, "w", encoding="utf-8") as f:
            f.write("\n".join(_LINES))
    except Exception:
        pass


def log(m):
    _LINES.append("[INFO] " + str(m))
    unreal.log("[Nuo][TA] " + str(m))


def warn(m):
    _LINES.append("[WARN] " + str(m))
    unreal.log_warning("[Nuo][TA] " + str(m))


# ---------------------------------------------------------------- 连线工具
_OUT_CANDIDATES = ["", "Value", "RGB", "R", "XYZ", "RGBA"]


def C(src, src_out, dst, pin):
    """把 src 的 src_out 连到 dst 的 pin（dst 为表达式时 pin 是输入名，为属性时 pin 是属性名）。
    输出引脚名在各版本/各节点上不一致，这里逐个候选试。"""
    outs = [src_out] + [o for o in _OUT_CANDIDATES if o != src_out]
    for out in outs:
        try:
            if isinstance(pin, unreal.MaterialProperty):
                mel.connect_material_property(src, out, pin)
            else:
                mel.connect_material_expressions(src, out, dst, pin)
            return True
        except Exception:
            continue
    warn("连线失败: %s.%s -> %s" % (src.get_name(), src_out, pin))
    return False


def E(cls, x, y):
    return mel.create_material_expression(mat, cls, x, y)


def scalar(name, value, x, y):
    n = E(unreal.MaterialExpressionScalarParameter, x, y)
    n.set_editor_property("parameter_name", name)
    n.set_editor_property("default_value", value)
    return n


def const(v, x, y):
    n = E(unreal.MaterialExpressionConstant, x, y)
    n.set_editor_property("r", v)
    return n


def const3(r, g, b, x, y):
    n = E(unreal.MaterialExpressionConstant3Vector, x, y)
    n.set_editor_property("constant", unreal.LinearColor(r, g, b, 1.0))
    return n


def mul(a, a_out, b, b_out, x, y):
    n = E(unreal.MaterialExpressionMultiply, x, y)
    C(a, a_out, n, "A")
    C(b, b_out, n, "B")
    return n


def add(a, a_out, b, b_out, x, y):
    n = E(unreal.MaterialExpressionAdd, x, y)
    C(a, a_out, n, "A")
    C(b, b_out, n, "B")
    return n


def lerp(a, a_out, b, b_out, alpha, alpha_out, x, y):
    n = E(unreal.MaterialExpressionLinearInterpolate, x, y)
    C(a, a_out, n, "A")
    C(b, b_out, n, "B")
    C(alpha, alpha_out, n, "Alpha")
    return n


def clamp01(src, src_out, x, y):
    n = E(unreal.MaterialExpressionClamp, x, y)
    C(src, src_out, n, "Input")
    n.set_editor_property("min_default", 0.0)
    n.set_editor_property("max_default", 1.0)
    return n


def noise01(freq_expr, freq_out, scale_param, x, y, label):
    """UV*freq -> float3 -> Noise，输出归一到 0..1"""
    f = mul(freq_expr, freq_out, scale_param, "", x, y)
    app = E(unreal.MaterialExpressionAppendVector, x + 120, y)
    C(f, "", app, "A")
    C(const(0.0, x + 120, y + 80), "", app, "B")
    nz = E(unreal.MaterialExpressionNoise, x + 240, y)
    C(app, "", nz, "Position")
    try:
        nz.set_editor_property("scale", 1.0)
        nz.set_editor_property("quality", 1)
        nz.set_editor_property("levels", 2)
        nz.set_editor_property("output_min", 0.0)
        nz.set_editor_property("output_max", 1.0)
        nz.set_editor_property("turbulence", False)
    except Exception as exc:
        warn("%s 参数设置部分失败: %s" % (label, exc))
    return nz


# ---------------------------------------------------------------- 1. MPC
def ensure_mpc():
    if EAL.does_asset_exist(MPC_PATH):
        log("MPC_NuoWeather 已存在，复用（参数不重建）")
        return EAL.load_asset(MPC_PATH)

    def sp(name, val):
        p = unreal.CollectionScalarParameter()
        for prop in ("parameter_name", "ParameterName"):
            try:
                p.set_editor_property(prop, name)
                break
            except Exception:
                continue
        for prop in ("default_value", "DefaultValue"):
            try:
                p.set_editor_property(prop, val)
                break
            except Exception:
                continue
        return p

    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mpc = tools.create_asset("MPC_NuoWeather", "/Game/Materials",
                             unreal.MaterialParameterCollection,
                             unreal.MaterialParameterCollectionFactoryNew())
    if not mpc:
        warn("MPC 创建失败")
        return None
    params = [
        sp("RainWetness", 0.85),      # 0=干 1=暴雨全湿：全场景湿度总闸
        sp("PuddleLevel", 0.55),      # 水洼覆盖比例 0..1
        sp("WetDarkening", 0.55),     # 湿表面反照率乘数（越小越黑）
        sp("WetRoughness", 0.06),     # 水膜粗糙度
        sp("RainIntensity", 1.0),     # 给雨丝/涟漪材质用
    ]
    mpc.set_editor_property("scalar_parameters", params)
    EAL.save_asset(MPC_PATH)
    log("MPC_NuoWeather 已创建，5 个全局参数")
    return mpc


# ---------------------------------------------------------------- 2. 母材质
def build(mpc):
    global mat
    if EAL.does_asset_exist(MAT_PATH):
        # 原地清空重建：比"删了再建"安全（不会留下被引用的悬空父材质）
        mat = EAL.load_asset(MAT_PATH)
        try:
            mel.delete_all_material_expressions(mat)
            log("已清空旧图，原地重建")
        except Exception as exc:
            warn("清空旧图失败（%s），将直接叠加" % exc)
    else:
        tools = unreal.AssetToolsHelpers.get_asset_tools()
        mat = tools.create_asset("M_NuoSurface", "/Game/Materials",
                                 unreal.Material, unreal.MaterialFactoryNew())
    if not mat:
        warn("母材质创建失败")
        return False

    # ---- UV
    tc = E(unreal.MaterialExpressionTextureCoordinate, -2200, -400)
    tc.set_editor_property("coordinate_index", 0)
    tiling = scalar("Tiling", 1.0, -2200, -300)
    uv = mul(tc, "RGB", tiling, "", -2050, -380)

    # ---- 三个采样
    samples = {}
    default_color = EAL.load_asset("/Engine/EngineResources/DefaultTexture")
    for pname, sampler, y, is_normal in (
        ("BaseColorTex", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR, -200, False),
        ("NormalTex", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL, 120, True),
        ("RoughnessTex", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR, 440, False),
    ):
        s = E(unreal.MaterialExpressionTextureSampleParameter2D, -1780, y)
        s.set_editor_property("parameter_name", pname)
        s.set_editor_property("sampler_type", sampler)
        s.set_editor_property("const_coordinate", 0)
        tex = default_color
        if is_normal:
            tex = None
            # 项目内贴图优先：引擎内建 DefaultNormal 在 5.8 已不在 AssetRegistry 里，
            # 先探测它只会刷两条 Error 并把进程退出码顶成 1
            for cand in ("/Game/Textures/Ground_WoodFloor/WoodFloor051_1K-JPG_NormalDX",
                         "/Game/Textures/Wall_Mud/Clay005_1K-JPG_NormalDX",
                         "/Engine/EngineResources/DefaultNormal",
                         "/Engine/EngineMaterials/DefaultNormal"):
                tex = EAL.load_asset(cand)
                if tex:
                    log("NormalTex 默认贴图：%s" % cand)
                    break
        if tex:
            s.set_editor_property("texture", tex)
        C(uv, "", s, "Coordinates")
        samples[pname] = s

    base = samples["BaseColorTex"]
    nrm = samples["NormalTex"]
    rgh = samples["RoughnessTex"]

    # ---- 全局参数（MPC）
    coll = E(unreal.MaterialExpressionCollectionParameter, -2200, 620)
    if mpc:
        coll.set_editor_property("collection", mpc)
    else:
        warn("MPC 为空，Collection 节点将无效")

    def coll_param(name, x, y):
        n = E(unreal.MaterialExpressionCollectionParameter, x, y)
        if mpc:
            n.set_editor_property("collection", mpc)
        n.set_editor_property("parameter_name", name)
        return n

    rain_wet = coll_param("RainWetness", -1800, 700)
    puddle_lvl = coll_param("PuddleLevel", -1800, 780)
    wet_dark = coll_param("WetDarkening", -1800, 860)
    wet_rough = coll_param("WetRoughness", -1800, 940)

    # ---- 湿度总掩码 = RainWetness(全局) × Wetness(本材质)
    wet_local = scalar("Wetness", 1.0, -1800, 620)
    wet = mul(rain_wet, "", wet_local, "", -1580, 650)
    wet = clamp01(wet, "", -1420, 650)

    # ---- 水洼掩码：低频噪声阈值 × PuddleLevel
    nz_puddle = noise01(uv, "", const(0.045, -1980, 1080), -1960, 1000, "PuddleNoise")
    p_centered = add(nz_puddle, "", const(-0.5, -1700, 1120), "", -1720, 1020)
    p_sharp = mul(p_centered, "", const(4.0, -1540, 1120), "", -1560, 1020)
    p_mask = clamp01(p_sharp, "", -1400, 1020)
    puddle = mul(p_mask, "", puddle_lvl, "", -1260, 1020)
    puddle = mul(puddle, "", wet, "", -1120, 1020)   # 干的时候没有水洼

    # ---- 宏观色变：打散贴图重复（0.85 ~ 1.15）
    nz_macro = noise01(uv, "", const(0.09, -1980, 1320), -1960, 1240, "MacroNoise")
    macro_var = scalar("MacroVariation", 0.15, -1780, 1360)
    m_off = mul(nz_macro, "", const(2.0, -1800, 1440), "", -1620, 1300)   # 0..1 -> 0..2
    m_off = add(m_off, "", const(-1.0, -1620, 1440), "", -1460, 1300)     # -> -1..1
    m_scaled = mul(m_off, "", macro_var, "", -1300, 1300)                 # ±Var
    macro = add(m_scaled, "", const(1.0, -1300, 1420), "", -1120, 1300)   # 1±Var

    # ---- 颜色：湿则变暗饱和
    darkened = mul(base, "RGB", wet_dark, "", -940, -120)
    base_wet = lerp(base, "RGB", darkened, "", wet, "", -760, -160)
    base_final = mul(base_wet, "", macro, "", -560, -200)
    C(base_final, "", mat, unreal.MaterialProperty.MP_BASE_COLOR)

    # ---- 法线：水洼里法线被水面抹平
    puddle_n = mul(puddle, "", const(0.85, -940, 200), "", -800, 200)
    flat_n = const3(0.0, 0.0, 1.0, -940, 300)
    nrm_final = lerp(nrm, "RGB", flat_n, "", puddle_n, "", -620, 160)
    C(nrm_final, "", mat, unreal.MaterialProperty.MP_NORMAL)

    # ---- 粗糙度：湿 -> 低粗糙；水洼 -> 近镜面
    r_wet = lerp(rgh, "R", wet_rough, "", wet, "", -940, 460)
    r_final = lerp(r_wet, "", const(0.02, -940, 560), "", puddle, "", -620, 460)
    C(r_final, "", mat, unreal.MaterialProperty.MP_ROUGHNESS)

    # ---- 金属度：湿石头不是金属，但水膜有菲涅尔——交给镜面反射，不碰金属度
    C(const(0.0, -560, 620), "", mat, unreal.MaterialProperty.MP_METALLIC)

    try:
        mel.recompile_material(mat)
    except Exception as exc:
        warn("编译调用失败：%s" % exc)
    EAL.save_asset(MAT_PATH)

    # ---- 报一下成本（写进验收文档）
    try:
        exprs = mel.get_material_expressions(mat)
        log("表达式节点数 = %d" % len(exprs))
    except Exception:
        pass
    for prop, label in ((unreal.MaterialProperty.MP_BASE_COLOR, "BaseColor"),
                        (unreal.MaterialProperty.MP_NORMAL, "Normal"),
                        (unreal.MaterialProperty.MP_ROUGHNESS, "Roughness"),
                        (unreal.MaterialProperty.MP_METALLIC, "Metallic")):
        try:
            node = mel.get_material_property_input_node(mat, prop)
            log("%s <- %s" % (label, node.get_class().get_name() if node else "None"))
        except Exception:
            pass
    try:
        log("Scalar 参数 = %s" % mel.get_scalar_parameter_names(mat))
    except Exception:
        pass
    try:
        log("Texture 参数 = %s" % mel.get_texture_parameter_names(mat))
    except Exception:
        pass
    try:
        st = mel.get_statistics(mat)
        log("Shader 指令数 = %s / 纹理采样 = %s / 参数数 = %s" % (
            st.num_pixel_shader_instructions, st.num_texture_samples,
            st.num_pixel_shader_parameters))
    except Exception:
        log("统计接口不可用（不影响材质）")

    log("M_NuoSurface v2 完成：湿润层 + 水洼 + 宏观色变；参数 Wetness/MacroVariation/Tiling")
    return True


try:
    ok = build(ensure_mpc())
    _LINES.append("RESULT = %s" % ("OK" if ok else "FAILED"))
except Exception as exc:
    import traceback
    _LINES.append("EXCEPTION: %s" % exc)
    _LINES.append(traceback.format_exc())
    raise
finally:
    _flush()
