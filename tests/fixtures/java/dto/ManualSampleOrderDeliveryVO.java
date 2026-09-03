package com.example.sample.sample.dto.viewobject;

import com.example.sample.common.utils.StringProcessUtils;
import com.example.sample.sample.domain.enums.DeliveryCompanyCodeEnum;
import com.example.sample.common.dto.ViewObject;
import com.example.sample.framework.biz.utils.BizAssert;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;
import org.apache.commons.lang3.StringUtils;

@Getter
@Setter
public class ManualSampleOrderDeliveryVO extends ViewObject {

    private static final long serialVersionUID = 1L;

    @ApiModelProperty("物流公司编码")
    private String companyCode;
    @ApiModelProperty("物流单号")
    private String trackingNo;
    @ApiModelProperty("收货人手机号")
    private String consigneePhone;

    /***
     *  物流公司选择顺丰时，必须填写收件人手机号
     */
    public void checkConsigneePhone() {
        //用code判断物流公司
        if (DeliveryCompanyCodeEnum.SF.name().equals(companyCode)) {
            BizAssert.isTrue(StringUtils.isNotBlank(consigneePhone), "物流公司选择顺丰时，必须填写收件人手机号");
            BizAssert.isTrue(StringProcessUtils.isMobile(consigneePhone), "填写的收件人手机号格式不正确，请检查");
        }
    }
}
