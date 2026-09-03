package com.example.sample.sample.dto.viewobject;

import com.example.sample.sample.domain.enums.SampleOrderStatusEnum;
import com.example.sample.common.dto.ViewObject;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

/***
 * 样品列表状态数量总计
 */
@Getter
@Setter
public class SampleOrderStatusCountVO extends ViewObject {

    @ApiModelProperty("状态")
    private SampleOrderStatusEnum status;
    @ApiModelProperty("状态名称")
    private String statusName;

    @ApiModelProperty("数量")
    private Long num;
}
