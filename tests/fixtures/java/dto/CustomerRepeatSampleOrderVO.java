package com.example.sample.sample.dto.viewobject;

import com.example.sample.common.dto.ViewObject;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.List;

/***
 * 用来校验并返回客户重复样品的信息
 */
@Getter
@Setter
public class CustomerRepeatSampleOrderVO extends ViewObject {

    @ApiModelProperty("后端查询的客户近N天，前端可以直接展示")
    private Integer day;

    @ApiModelProperty("样品单数量")
    private Integer sampleOrderCount;

    @ApiModelProperty("总商城价格")
    private BigDecimal mallPrice;

    @ApiModelProperty("商品列表")
    private List<CustomerRepeatCommodityVO> commodityList;
}
