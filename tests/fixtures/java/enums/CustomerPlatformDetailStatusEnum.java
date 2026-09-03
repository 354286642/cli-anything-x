package com.example.sample.customer.domain.model.enums;

import com.google.common.collect.ImmutableList;
import com.google.common.collect.ImmutableSet;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.List;
import java.util.Set;

/**
 * 客户状态
 * dict_customer_status
 */
@AllArgsConstructor
public enum CustomerPlatformDetailStatusEnum {

    WAIT_CRAWL("客户认证中"),
    NORMAL("正常"),
    ERROR("链接错误"),
    LOGOUT("账号注销"),
    BANNED("账号被封"),

    /**
     * 之前是NORMAL正常状态，后续周期性更新爬取结果为错误的情况下，更新为此状态，不包括账号被禁用
     */
    UPDATE_FAIL("周期更新失败");

    @Getter
    private final String name;


    /**
     * 客户广场能显示的客户状态
     */
    public static final List<CustomerPlatformDetailStatusEnum> CUSTOMER_DISPLAY_STATUS = ImmutableList.of(WAIT_CRAWL, NORMAL, BANNED, UPDATE_FAIL);
    /**
     * 客户异常状态
     */
    public static final List<CustomerPlatformDetailStatusEnum> EXCEPTION_STATUS = ImmutableList.of(ERROR, LOGOUT, BANNED);
    /**
     * 客户正常状态
     */
    public static final Set<CustomerPlatformDetailStatusEnum> NORMAL_STATUS = ImmutableSet.of(NORMAL, UPDATE_FAIL);

    /**
     * 自链种草能补录校验的客户状态(正常、账号被封、账号注销、周期更新失败)
     */
    public static final Set<CustomerPlatformDetailStatusEnum> HISTORY_LAUNCH_DATA_CHECK_CUSTOMER_STATUS = ImmutableSet.of(NORMAL, BANNED, LOGOUT, UPDATE_FAIL);

}

