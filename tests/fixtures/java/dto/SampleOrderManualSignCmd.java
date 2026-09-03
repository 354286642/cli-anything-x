package com.example.sample.sample.dto.command;

import com.example.sample.common.dto.Command;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import javax.validation.constraints.NotBlank;

/***
 * 手动签收样品单物流
 */
@Getter
@Setter
public class SampleOrderManualSignCmd extends Command {

    @ApiModelProperty("物流单id")
    @NotBlank
    private String id;

    @ApiModelProperty("签收说明")
    @NotBlank
    private String remark;
}
