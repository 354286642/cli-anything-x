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
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * @date ：Created in 2021/3/4 11:55
 */
@AllArgsConstructor
public enum PlatformEnum {
    /**
     * 平台
     */
    EMPTY(""),
    TAO_BAO(Constants.TAO_BAO),
    DOU_YIN(Constants.DOU_YIN),
    KUAI_SHOU(Constants.KUAI_SHOU),
    XIAO_HONG_SHU("小红书"),
    BILI("B站"),
    JING_DONG("京东"),
    WEI_BO("微博"),
    ZHI_HU("知乎"),
    DOU_YU("斗鱼"),
    HUO_SHAN("火山"),
    XI_GUA("西瓜"),
    DE_WU("得物"),
    XIN_YANG("新氧"),
    MEI_LI_XIU_XING("美丽修行"),
    MEI_TU_XIU_XIU("美图秀秀"),
    LV_ZHOU("绿洲"),
    DA_ZHONG_DIAN_PING("大众点评"),
    JIN_RI_TOU_TIAO("今日头条"),
    BAI_JIA_HAO("百家号"),
    XI_WU_JIE("西五街"),
    XIANG_SHUI_SHI_DAI("香水时代"),
    PIN_DUO_DUO("拼多多"),
    WEI_PIN_HUI("唯品会"),

    MO_GU_JIE("蘑菇街"),
    XIAO_YU_ZHOU("小宇宙"),
    WEI_XIN_VIDEO("视频号"),
    WEI_XIN_OFFICIAL("公众号"),
    // 目前是提供给清博舆情的平台翻译
    WEI_XIN("微信"),
    TIK_TOK("TIKTOK"),

    // 蒲公英平台，用于种草推荐推送爬虫
    PGY_RECO("PGY_RECO");

    @Getter
    private final String name;

    public static PlatformEnum parseEnum(String target) {
        for (PlatformEnum platform : PlatformEnum.values()) {
            if (platform.name().equals(target)) {
                return platform;
            }
        }
        return null;
    }

    public static PlatformEnum parseByLaunchPlatformEnum(LaunchPlatformEnum target) {
        if (target != null) {
            for (PlatformEnum platform : PlatformEnum.values()) {
                if (platform.name().equals(target.name())) {
                    return platform;
                }
            }
        }
        return null;
    }

    public static PlatformEnum parse(String name) {
        for (PlatformEnum platform : PlatformEnum.values()) {
            if (platform.getName().equalsIgnoreCase(name)) {
                return platform;
            }
        }
        return null;
    }

    public static class Constants {
        public static final String TAO_BAO = "淘宝";
        public static final String DOU_YIN = "抖音";
        public static final String KUAI_SHOU = "快手";
    }

    public static String parseByValues(String values) {
        List<String> list = Lists.newArrayList();
        if (StringUtils.isNotBlank(values)) {
            String[] split = values.split(",");
            for (String s : split) {
                PlatformEnum parse = parseEnum(s);
                if (parse != null) {
                    list.add(parse.getName());
                }
            }
        }
        return String.join(",", list);
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

    /**
     * 支持爬虫爬取平台列表
     * 配合字典 crawl_platform_list
     */
    public static final List<PlatformEnum> CRAWL_PLATFORM_LIST = ImmutableList.of(DOU_YIN, XIAO_HONG_SHU, WEI_BO, TAO_BAO, KUAI_SHOU, BILI);
    /**
     * 支持爬虫爬取平台列表
     */
    public static final Set<String> CRAWL_PLATFORM_LIST_STRING = ImmutableSet.of(DOU_YIN.name(), XIAO_HONG_SHU.name(), WEI_BO.name(), TAO_BAO.name(), KUAI_SHOU.name(), BILI.name());

    /***
     * 检验客户ID必填的平台
     */
    public static final Set<PlatformEnum> CHECK_ACCOUNT_ID_PLATFORMS = ImmutableSet.of(WEI_XIN_VIDEO, WEI_XIN_OFFICIAL);

    /**
     * 达播支持的平台
     */
    public static final Set<PlatformEnum> CUSTOMER_LIVE_PLATFORM = ImmutableSet.of(DOU_YIN, KUAI_SHOU, TAO_BAO, XIAO_HONG_SHU, WEI_XIN_VIDEO, BILI);

    /**
     * 客户广场支持平台
     */
    public static final List<PlatformEnum> CUSTOMER_SQUARE_PLATFORM_LIST = ImmutableList.of(DOU_YIN, XIAO_HONG_SHU, WEI_BO, TAO_BAO, KUAI_SHOU, BILI, WEI_XIN_VIDEO, TIK_TOK);

    /**
     * 支持爬虫爬取作品评论数据的平台
     */
    public static final Set<String> CRAWL_NOTE_COMMENT_PLATFORM_LIST_STRING = ImmutableSet.of(DOU_YIN.name(), XIAO_HONG_SHU.name());


    /***
     * 可爬取的平台过滤掉指定的平台
     * customerUpdateFilterPlatforms  多个平台逗号分隔
     */
    public static List<PlatformEnum> crawlPlatformFilter(String customerUpdateFilterPlatforms) {
        List<PlatformEnum> platformList = CRAWL_PLATFORM_LIST;
        // 兼容爬虫异常，过滤配置的不推送的平台
        if (StringUtils.isNotBlank(customerUpdateFilterPlatforms)) {
            platformList = platformList.stream()
                    .filter(x -> !Arrays.stream(StringUtils.split(customerUpdateFilterPlatforms, ","))
                            .map(PlatformEnum::parseEnum)
                            .filter(Objects::nonNull)
                            .collect(Collectors.toList())
                            .contains(x))
                    .collect(Collectors.toList());
        }
        return platformList;
    }

}
