package com.example.sample.sample.dto.command;

import com.example.sample.sample.domain.enums.SampleOrderExpirationRequirementEnum;
import com.example.sample.sample.domain.enums.SampleOrderExpressRequirementEnum;
import com.example.sample.sample.domain.enums.SampleOrderPublicMailTypeEnum;
import com.example.sample.common.dto.Command;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.List;

/***
 * 创建样品单时，是可能多个样品一起创建，这里是每个样品的明细
 */
@Getter
@Setter
public class CreateSampleOrderDetailsCmd extends Command {

    @ApiModelProperty("领用用途二级分类id")
    private Integer subPurposeId;

    @ApiModelProperty("当领用用途为客户时，对应平台客户ID")
    private String customerPlatformId;

    @ApiModelProperty("当领用用途为客户时，对应客户的url")
    private String homePageUrl;

    @ApiModelProperty("当领用用途为自播时，对应自播间ID")
    private String selfRoomId;

    @ApiModelProperty("当领用用途为MCN机构时，对应的mcn_info的主键id")
    private String mcnInfoId;

    @ApiModelProperty("领用用途选办公室备样时，对应的办公室编码")
    private String purposeOfficeWarehouseCode;

    @ApiModelProperty("当领用用途不为客户和自播时，对应的具体描述。如活动名称、需求名称、公关原因")
    private String purposeDesc;

    @ApiModelProperty("收货人姓名。 无需邮寄时为空")
    private String consigneeName;

    @ApiModelProperty("收货人联系方式。")
    private String consigneePhone;

    @ApiModelProperty("收货人详细地址，不包括省市区")
    private String consigneeAddress;
    @ApiModelProperty("收货人省")
    private String consigneeProvince;
    @ApiModelProperty("收货人市")
    private String consigneeCity;
    @ApiModelProperty("收货人县区")
    private String consigneeArea;

    @ApiModelProperty("效期要求。默认30个月以上，可选12个月内（WITHIN_12_MONTHS）/12-24个月（BETWEEN_12_AND_24_MONTHS）/24-30个月（BETWEEN_24_AND_30_MONTHS）/30个月以上（OVER_30_MONTHS）")
    private SampleOrderExpirationRequirementEnum expirationRequirement;

    @ApiModelProperty("样品物流要求(适用于仓库直接寄出，公件物流要求)")
    private SampleOrderExpressRequirementEnum expressRequirement;

    @ApiModelProperty("公件类型。 仓库/办公室公件寄出时需要填写，默认长沙国内件，可选长沙国际件、上海寄出")
    private SampleOrderPublicMailTypeEnum publicMailType;

    @ApiModelProperty("保价状态。0 不保价。1 保价")
    private String insureStatus;

    @ApiModelProperty("保价时填入的商品总金额")
    private BigDecimal insureGoodsAmt;

    @ApiModelProperty(value = "实际保价金额。 保价商品金额/100", hidden = true)
    private BigDecimal insureAmt;

    @ApiModelProperty("样品是否需要退回。0 不需要，1 需要")
    private String sampleIsNeedReturn;

    @ApiModelProperty("其他备注")
    private String remark;

    @ApiModelProperty("备注给仓库的发货要求")
    private String warehouseRemark;

    @ApiModelProperty("样品商品")
    private List<CreateSampleOrderCommodityCmd> commodityList;

    @ApiModelProperty("是否为本次新增客户。0 不是，1 是； 注意为是时，customerPlatformId不能为空")
    private String izCreateCustomer;

    @ApiModelProperty("关联分组id（来自种草打通样品）")
    private String groupId;

    public void emptyPublicMailType() {
        //公件类型清空
        this.publicMailType = null;
        this.insureStatus = null;
        this.insureAmt = null;
        this.insureGoodsAmt = null;
    }

    public void emptyConsignee() {
        this.consigneeName = null;
        this.consigneePhone = null;
        this.consigneeAddress = null;
        this.consigneeProvince = null;
        this.consigneeCity = null;
        this.consigneeArea = null;
    }
}
