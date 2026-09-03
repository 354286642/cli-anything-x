package com.example.sample.sample.dto.viewobject;

import com.example.sample.sample.domain.enums.SampleOrderExpirationRequirementEnum;
import com.example.sample.common.dto.ViewObject;
import com.example.sample.framework.biz.convert.Converted;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

/***
 * 某一个商品拆分效期要求对应数量
 */
@Getter
@Setter
public class CommodityExpirationVO extends ViewObject {
    @ApiModelProperty("效期拆分后自身的业务id")
    private String id;
    @ApiModelProperty("对应的数量")
    private Integer commodityNum;
    @ApiModelProperty("效期要求")
    private SampleOrderExpirationRequirementEnum expirationRequirement;
    @ApiModelProperty("效期要求名称")
    @Converted(dependProperty = "expirationRequirement", type = "dict_sample_order_expiration_requirement")
    private String expirationRequirementName;
}
