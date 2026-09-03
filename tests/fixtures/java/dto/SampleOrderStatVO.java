package com.example.sample.sample.dto.viewobject;

import com.example.sample.common.dto.ViewObject;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;

/***
 * 样品数据统计指标
 */
@Getter
@Setter
public class SampleOrderStatVO extends ViewObject {

    @ApiModelProperty("客户数（仅包含客户带货/客户种草，去重）")
    private Long customerNum;

    @ApiModelProperty("样品单量（仅包含客户带货/客户种草）")
    private Long num;

    @ApiModelProperty("产品价值（仅包含客户带货/客户种草），产品商城价")
    private BigDecimal commodityAmount;

    @ApiModelProperty("已出单量（仅包含客户带货/客户种草）")
    private Long completedNum;

    @ApiModelProperty("种草已出单量")
    private Long worksCompletedNum;

    @ApiModelProperty("客户带货已出单量")
    private Long liveCompletedNum;

    @ApiModelProperty("种草已签收量")
    private Long worksSignedNum;

    @ApiModelProperty("客户带货已签收量")
    private Long liveSignedNum;

    @ApiModelProperty("达播出单率，计算字段：带货已出单量/带货已签收量")
    private BigDecimal liveCooperationRate;

    @ApiModelProperty("种草作品出单率，计算字段：种草已出单量/种草已签收量")
    private BigDecimal worksCooperationRate;
}
