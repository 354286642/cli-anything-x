package com.example.sample.sample.domain.enums;

import com.google.common.collect.ImmutableList;
import com.google.common.collect.ImmutableSet;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.List;
import java.util.Set;

/***
 *  样品状态. 字典：dict_sample_order_status
 */
@AllArgsConstructor
public enum SampleOrderStatusEnum {

    DRAFT("草稿"),
    WAIT_SUBMIT("待提审"),
    WAIT_AUDIT("待审核"),
    WAIT_SHIPMENT("待发货"),
    SHIPPED("已发货"),
    SIGNED("已签收"),
    CLOSED("已关闭");

    @Getter
    private final String name;


    /***
     *  可以继续编辑的状态
     */
    public static final Set<SampleOrderStatusEnum> CAN_UPDATE_STATUS_SET = ImmutableSet.of(DRAFT, WAIT_SUBMIT);

    /***
     *  可以取消，作废的样品单状态
     */
    public static final Set<SampleOrderStatusEnum> CAN_CANCEL_STATUS_SET = ImmutableSet.of(DRAFT, WAIT_SUBMIT);

    /***
     *  可以修改物流状态的类型。 仅当前为已发货或者是已签收，才会通过物流轨迹变化更新状态
     */
    public static final Set<SampleOrderStatusEnum> UPDATE_DELIVERY_STATUS_SET = ImmutableSet.of(SHIPPED, SIGNED);


    /***
     *  校验客户重复样品对应的样品单状态。
     */
    public static final Set<SampleOrderStatusEnum> CUSTOMER_REPEAT_SEND_SAMPLE_CHECK_STATUS_SET = ImmutableSet.of(WAIT_AUDIT, WAIT_SHIPMENT, SHIPPED, SIGNED);

    /***
     *  可以手动修改物流单号的状态。
     */
    public static final Set<SampleOrderStatusEnum> MANUAL_UPDATE_DELIVERY_STATUS_SET = ImmutableSet.of(WAIT_SHIPMENT, SHIPPED, SIGNED);

    /**
     * 统计指标，默认状态
     */
    public static final List<SampleOrderStatusEnum> STAT_STATUS_LIST = ImmutableList.of(WAIT_SHIPMENT, SHIPPED, SIGNED);


    /**
     * OA审核通过后的状态
     */
    public static final List<SampleOrderStatusEnum> OA_AUDIT_COMPLETED_STATUS_LIST = ImmutableList.of(WAIT_SHIPMENT, SHIPPED, SIGNED);

    /***
     * 允许发起退货的样品单状态
     */
    public static final Set<SampleOrderStatusEnum> ALLOW_RETURN_SAMPLE_STATUS_SET = ImmutableSet.of(SHIPPED, SIGNED);
}
