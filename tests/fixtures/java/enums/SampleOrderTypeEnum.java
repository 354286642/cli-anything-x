package com.example.sample.sample.domain.enums;

import com.google.common.collect.ImmutableSet;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Set;

/***
 *  样品类型； 字典：dict_sample_order_type
 */
@AllArgsConstructor
public enum SampleOrderTypeEnum {

    /***
     * 所在地仓库
     */
    WAREHOUSE_SEND("从仓库直接寄出"),
    COMPANY_PUBLIC_MAIL_SEND("送至公司后公件寄出"),
    COMPANY_SELF_SEND("送至公司后自行寄出"),
    COMPANY_NO_SEND("送至公司后无需邮寄"),

    /***
     *  所在地办公室
     */
    PUBLIC_MAIL_SEND("公件寄出"),
    SELF_SEND("自行寄出"),
    NO_SEND("无需邮寄");


    @Getter
    private final String name;

    /***
     *  样品需要公司收货的类型
     */
    public static final Set<SampleOrderTypeEnum> COMPANY_CONSIGNEE_SET = ImmutableSet.of(COMPANY_PUBLIC_MAIL_SEND, COMPANY_SELF_SEND, COMPANY_NO_SEND);

    /***
     *  样品需要第三方收货的类型
     */
    public static final Set<SampleOrderTypeEnum> CONSIGNEE_SET = ImmutableSet.of(WAREHOUSE_SEND, COMPANY_PUBLIC_MAIL_SEND, PUBLIC_MAIL_SEND);

    /***
     *  不需要邮寄的类型
     */
    public static final Set<SampleOrderTypeEnum> NOT_NEED_SEND_MAIL_SET = ImmutableSet.of(COMPANY_SELF_SEND, COMPANY_NO_SEND, SELF_SEND, NO_SEND);

    /***
     * 公件寄出的类型
     */
    public static final Set<SampleOrderTypeEnum> PUBLIC_MAIL_SEND_SET = ImmutableSet.of(COMPANY_PUBLIC_MAIL_SEND, PUBLIC_MAIL_SEND);


    /***
     * 支持手动更新物流的类型。 自行寄出的场景
     */
    public static final Set<SampleOrderTypeEnum> MANUAL_UPDATE_DELIVERY_SET = ImmutableSet.of(COMPANY_SELF_SEND, SELF_SEND);


    /***
     * 无需邮寄，可以自动签收的类型
     */
    public static final Set<SampleOrderTypeEnum> NO_SEND_AUTO_SIGNED_SET = ImmutableSet.of(COMPANY_NO_SEND, NO_SEND);
}
