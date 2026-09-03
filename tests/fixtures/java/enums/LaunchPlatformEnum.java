package com.example.sample.common.constants;

import com.google.common.collect.ImmutableList;
import com.google.common.collect.ImmutableSet;
import com.google.common.collect.Lists;
import com.google.common.collect.Maps;
import lombok.AllArgsConstructor;
import lombok.Getter;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * @Name LaunchPlatformEnum
 * @Description 投放平台类型(字典dict_launch_platform)
 * @date 2021/11/22
 */
@AllArgsConstructor
public enum LaunchPlatformEnum {
    /**
     * 平台
     */
    TAO_BAO("淘宝", "01", "TB", "PT001"),
    DOU_YIN("抖音", "02", "DY", "PT017"),
    KUAI_SHOU("快手", "03", "KS", "PT063"),
    XIAO_HONG_SHU("小红书", "04", "XHS", "PT030"),
    BILI("B站", "06", "BL", "PT119"),
    WEI_BO("微博", "07", "WB", "PT120"),
    ZHI_HU("知乎", "08", "ZH", "PT121"),
    DE_WU("得物", "09", "DW", "PT036"),
    XIN_YANG("新氧", "10", "XY", "PT122"),
    MEI_LI_XIU_XING("美丽修行", "11", "MLXX", "PT123"),
    MEI_TU_XIU_XIU("美图秀秀", "12", "MTXX", "PT124"),
    LV_ZHOU("绿洲", "13", "LZ", "PT125"),
    DA_ZHONG_DIAN_PING("大众点评", "14", "DZDP", "PT126"),
    JIN_RI_TOU_TIAO("今日头条", "15", "JRTT", "PT051"),
    BAI_JIA_HAO("百家号", "16", "BJH", "PT127"),
    XI_WU_JIE("西五街", "17", "XWJ", "PT128"),
    XIANG_SHUI_SHI_DAI("香水时代", "18", "XSSD", "PT129"),

    // 自播平台（字典：dict_self_live_platform）
    JING_DONG("京东", "19", "JD", "PT034"),
    PIN_DUO_DUO("拼多多", "20", "PDD", "PT032"),
    WEI_PIN_HUI("唯品会", "21", "WPH", "PT059"),

    /*其他*/
    OTHER("其他", "22", "QT", ""),

    MO_GU_JIE("蘑菇街", "24", "MGJ", "PT021"),
    XIAO_YU_ZHOU("小宇宙", "25", "XYZ", "PT130"),
    WEI_XIN_VIDEO("视频号", "26", "SPH", "PT111"),
    WEI_XIN_OFFICIAL("公众号", "27", "GZH", "PT131"),
    TIK_TOK("TIKTOK", "28", "TT", "PT115");

    @Getter
    private final String name;

    /**
     * 支持爬虫爬取平台列表
     * 配合字典 crawl_platform_list
     */
    public static final Set<LaunchPlatformEnum> CRAWL_PLATFORM_LIST = ImmutableSet.of(DOU_YIN, XIAO_HONG_SHU, WEI_BO, TAO_BAO, KUAI_SHOU, BILI);

    /***
     * 检验客户ID必填的平台。 V5.1.3版本，除去之前爬取的几个平台，其余全部都需要校验ID必填
     */
    public static final Set<LaunchPlatformEnum> CHECK_ACCOUNT_ID_PLATFORMS = ImmutableSet.copyOf(
            Arrays.stream(values())
                    .filter(platform -> !CRAWL_PLATFORM_LIST.contains(platform))
                    .collect(Collectors.toSet())
    );

    /**
     * 平台号编码，两位，01-99
     * 用户生成投放计划、资源编码
     */
    @Getter
    private final String code;

    /**
     * 平台缩写。 抖音=DY
     */
    @Getter
    private final String shortCode;

    /***
     * 对应主数据的平台编码
     */
    @Getter
    private final String mainDataPlatformCode;

    /**
     * 自播直播间可填类型（字典：dict_self_live_platform）
     */
    public static final Set<LaunchPlatformEnum> SELF_LIVE_ROOM_CHECK_PLATFORM = ImmutableSet.of(DOU_YIN, KUAI_SHOU, TAO_BAO, JING_DONG, PIN_DUO_DUO, WEI_PIN_HUI, XIAO_HONG_SHU, WEI_XIN_VIDEO);
    /**
     * 自播日效果数据自动更新平台（抖音、快手、淘宝、小红书）
     */
    public static final List<LaunchPlatformEnum> SELF_LIVE_AUTO_PLATFORMS = ImmutableList.of(DOU_YIN, KUAI_SHOU, TAO_BAO, XIAO_HONG_SHU);

    /**
     * 微博、知乎、B站、淘宝、视频号、公众号，计划级别佣金比例计算规则：
     */
    public static final Set<LaunchPlatformEnum> COMMISSION_RATE_PLATFORM_SET = ImmutableSet.of(WEI_BO, ZHI_HU, BILI, TAO_BAO, WEI_XIN_VIDEO, WEI_XIN_OFFICIAL);

    /***
     *  可主动获取达播销售数据的平台
     */
    public static final Set<LaunchPlatformEnum> ACTIVE_GET_CUSTOMER_LIVE_SALE_EFFECT_SET = ImmutableSet.of(DOU_YIN, KUAI_SHOU, TAO_BAO, XIAO_HONG_SHU);

    /***
     * 作品爬取数据，指定平台取desc作为标题
     */
    public static final Set<LaunchPlatformEnum> WORKS_TITLE_BY_DESC_MAIN_PLATFORM = ImmutableSet.of(DOU_YIN, KUAI_SHOU, WEI_BO, TAO_BAO, XIAO_HONG_SHU);

    /**
     * 需要打爆文标签的平台
     */
    public static final Set<LaunchPlatformEnum> IS_HOT_WORKS_PLATFORM = ImmutableSet.of(XIAO_HONG_SHU, DOU_YIN, BILI, WEI_BO, WEI_XIN_VIDEO, WEI_XIN_OFFICIAL);

    /**
     * 需要额外处理打爆文标签的平台
     */
    public static final Set<LaunchPlatformEnum> NEED_HANDLE_HOT_WORKS_PLATFORM = ImmutableSet.of(BILI, WEI_BO, WEI_XIN_VIDEO, WEI_XIN_OFFICIAL);


    /***
     * 不检验链接的平台
     */
    public static final Set<LaunchPlatformEnum> NOT_CHECK_LINK_URL_PLATFORM = ImmutableSet.of(WEI_XIN_VIDEO, WEI_XIN_OFFICIAL);

    /**
     * 客户评价，计算性价比评分平台（小红书、淘宝、B站、抖音、快手、微博）
     */
    public static final Set<LaunchPlatformEnum> CUSTOMER_PLAN_COMMENT_PRICE_SCORE_PLATFORM = ImmutableSet.of(XIAO_HONG_SHU, TAO_BAO, BILI, DOU_YIN, KUAI_SHOU, WEI_BO);

    /***
     *  达播费控支持的所有平台。
     *  达播费控可支持自动更新坑位费的平台
     *  同步确认费控状态的平台
     *  可创建达播台账的平台
     */
    public static final Set<LaunchPlatformEnum> CUSTOMER_LIVE_SALE_PLATFORM_SET = ImmutableSet.of(DOU_YIN, KUAI_SHOU, TAO_BAO, XIAO_HONG_SHU, BILI, WEI_XIN_VIDEO, MO_GU_JIE);

    /**
     * 非小众平台，用来校验平台效果数据必填
     */
    public static final Set<LaunchPlatformEnum> NON_OTHER_PLATFORMS = ImmutableSet.of(DOU_YIN, KUAI_SHOU, TAO_BAO, XIAO_HONG_SHU, BILI, WEI_XIN_VIDEO, WEI_XIN_OFFICIAL, WEI_BO, ZHI_HU);

    /**
     * 飞书可手动上传发布链接的平台
     */
    public static final List<LaunchPlatformEnum> FEI_SHU_UPLOAD_LINK_PLATFORMS = ImmutableList.of(DOU_YIN, XIAO_HONG_SHU);

    public static String parseName(LaunchPlatformEnum target) {
        for (LaunchPlatformEnum platform : LaunchPlatformEnum.values()) {
            if (platform.equals(target)) {
                return target.getName();
            }
        }
        return null;
    }

    public static LaunchPlatformEnum parseByName(String target) {
        for (LaunchPlatformEnum platform : LaunchPlatformEnum.values()) {
            if (platform.getName().equalsIgnoreCase(target)) {
                return platform;
            }
        }
        return null;
    }

    public static LaunchPlatformEnum parse(String name) {
        for (LaunchPlatformEnum platform : LaunchPlatformEnum.values()) {
            if (platform.name().equals(name)) {
                return platform;
            }
        }
        return null;
    }

    public static String[] toArray() {
        return Arrays.stream(LaunchPlatformEnum.values())
                .map(LaunchPlatformEnum::getName)
                .toArray(String[]::new);
    }

    // 勿删, 操作日志用到
    public static Map<String, String> parseByValuesList(List<String> valuesList) {
        if (CollectionUtils.isEmpty(valuesList)) {
            return Maps.newHashMap();
        }
        Map<String, String> returnMap = Maps.newHashMap();
        valuesList.forEach(values -> {
            String s = parseByValues(values);
            if (StringUtils.isNotBlank(s)) {
                returnMap.put(values, s);
            }
        });
        return returnMap;
    }

    private static String parseByValues(String values) {
        List<String> list = Lists.newArrayList();
        if (StringUtils.isNotBlank(values)) {
            String[] split = values.split(",");
            for (String s : split) {
                LaunchPlatformEnum parse = parse(s);
                if (parse != null) {
                    list.add(parse.getName());
                }
            }
        }
        return String.join(",", list);
    }

    /**
     * 小众平台，用来校验平台效果数据必填
     */
    public static Set<LaunchPlatformEnum> otherPlatformList() {
        return Arrays.stream(LaunchPlatformEnum.values())
                .filter(platform -> !NON_OTHER_PLATFORMS.contains(platform))
                .collect(Collectors.toSet());
    }
}
