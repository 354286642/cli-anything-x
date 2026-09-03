package com.example.sample.sample.dto.command;

import com.example.sample.sample.dto.viewobject.ManualSampleOrderDeliveryVO;
import com.example.sample.common.dto.Command;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotEmpty;
import java.util.List;

/***
 * 手动维护样品单的物流信息
 */
@Getter
@Setter
public class ManualSampleOrderDeliveryCmd extends Command {

    @ApiModelProperty("样品单的id")
    @NotBlank
    private String id;

    @ApiModelProperty("渠道Code")
    private String channelCode;

    @ApiModelProperty("渠道名称")
    private String channel;

    @ApiModelProperty("所属公司编码")
    private String companyCode;

    @ApiModelProperty("所属公司")
    private String company;

    @ApiModelProperty("物流信息多个")
    @NotEmpty
    private List<ManualSampleOrderDeliveryVO> deliveryList;

}
