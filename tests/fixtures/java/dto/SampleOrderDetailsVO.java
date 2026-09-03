package com.example.sample.sample.dto.viewobject;

import com.example.sample.common.dto.ViewObject;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/***
 * 样品详情
 */
@Getter
@Setter
public class SampleOrderDetailsVO extends ViewObject {

    @ApiModelProperty("需求信息")
    private SampleOrderVO sampleOrderInfo;

    @ApiModelProperty("审核信息")
    private SampleOrderAuditVO auditInfo;

    @ApiModelProperty("样品的物流情况，可能有多个")
    private List<SampleOrderDeliveryVO> sampleDeliveryList;

    @ApiModelProperty("退货信息.一个样品信息可能对应多个退货信息")
    private List<SampleOrderReturnVO> returnInfoList;
}
