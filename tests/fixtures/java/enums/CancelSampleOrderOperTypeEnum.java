package com.example.sample.sample.domain.enums;

import com.google.common.collect.ImmutableSet;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Set;

/***
 *  已发货状态下，取消样品的操作类型。
 */
@AllArgsConstructor
public enum CancelSampleOrderOperTypeEnum {

    //从办公室领用
    OFFICE_RECEIVED("已领取样品"),
    OFFICE_NOT_RECEIVED("未领取样品"),

    //从仓库领用
    WAREHOUSE_NOT_SENT("仓库未发出"),
    WAREHOUSE_SENT_TO_COMPANY("仓库已发出至公司");


    @Getter
    private final String name;

    /***
     *  办公室领用对应的操作类型
     */
    public static final Set<CancelSampleOrderOperTypeEnum> OFFICE_SET = ImmutableSet.of(OFFICE_RECEIVED, OFFICE_NOT_RECEIVED);


    /***
     *  仓库领用对应的操作类型
     */
    public static final Set<CancelSampleOrderOperTypeEnum> WAREHOUSE_SET = ImmutableSet.of(WAREHOUSE_NOT_SENT, WAREHOUSE_SENT_TO_COMPANY);
}
