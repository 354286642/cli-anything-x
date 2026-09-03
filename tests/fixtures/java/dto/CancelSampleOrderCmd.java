package com.example.sample.sample.dto.command;

import com.example.sample.sample.domain.enums.CancelSampleOrderOperTypeEnum;
import com.example.sample.common.dto.Command;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import java.util.List;

/***
 * 待发货状态下，取消样品单
 */
@Getter
@Setter
public class CancelSampleOrderCmd extends Command {

    @ApiModelProperty("样品单id")
    @NotBlank
    private String id;

    @ApiModelProperty("取消样品的操作类型")
    @NotNull
    private CancelSampleOrderOperTypeEnum operType;

    @ApiModelProperty("退货商品信息")
    private List<CreateSampleOrderCommodityCmd> commodityList;

    @ApiModelProperty("退货备注")
    private String remark;

    @ApiModelProperty("办公室对应的仓库编码。当从仓库领用，且仓库已发出时需要指定值")
    private String sourceCode;
}
