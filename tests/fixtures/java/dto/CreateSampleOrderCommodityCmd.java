package com.example.sample.sample.dto.command;

import com.example.sample.sample.domain.enums.SampleWarehouseTypeEnum;
import com.example.sample.sample.dto.viewobject.CommodityExpirationVO;
import com.example.sample.common.dto.Command;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import javax.validation.constraints.Min;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;

/**
 * Description: 样品商品
 *
 * @version 2025-01-24
 */
@Getter
@Setter
public class CreateSampleOrderCommodityCmd extends Command {

    @ApiModelProperty(value = "归属样品单或退货单的主键id", hidden = true)
    private String bizId;

    @NotBlank
    @ApiModelProperty("商品编码")
    private String commodityCode;

    @ApiModelProperty("所属仓库编码")
    private String warehouseCode;

    @NotNull
    @Min(value = 1)
    @ApiModelProperty("商品数量")
    private Integer commodityNum;

    @ApiModelProperty("所属仓库类型")
    private SampleWarehouseTypeEnum warehouseType;

    @NotBlank
    @ApiModelProperty("商品条形码")
    private String commodityBarcode;

    @ApiModelProperty("商品名称")
    private String commodityName;
    @ApiModelProperty("商品商品编码")
    private String commodityBrandCode;
    @ApiModelProperty("商品商品名称")
    private String commodityBrandName;
    @ApiModelProperty("销售价/商城价")
    private BigDecimal commodityMallPrice;
    @ApiModelProperty("成本价")
    private BigDecimal commodityCostPrice;

    @ApiModelProperty("记录商品不同效期拆分的数量")
    private List<CommodityExpirationVO> commodityExpirationSplit;

    @ApiModelProperty("是否套装非捆绑商品. 1是其他否")
    private String izLooseSet;

    @ApiModelProperty(value = "商品id,用于特殊情况下提前设置好商品的id", hidden = true)
    private String id;

}