package com.example.sample.sample.domain.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/***
 * 样品是否退回，如果退回对应的退回状态。 和样品单的状态不一样哦
 * 1.待退货，样品单标记样品需退回，且未关联退货单。
 * 2.退货中，样品单关联退货单，且退货单存在未审核完成的单据。
 * 3.已退货，样品单关联退货单，且退货单均审核完成。
 *
 * 可能多次退货, 那就可能从 已退货再变为 退货中 了
 * 字典：dict_sample_order_return_status
 */
@AllArgsConstructor
public enum SampleOrderReturnStatusEnum {

    WAIT_RETURN("待退货"),
    RETURN_ING("退货中"),
    RETURN_ALREADY("已退货");

    @Getter
    private final String name;
}
