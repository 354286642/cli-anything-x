package com.example.sample.sample.dto.command;

import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import javax.validation.constraints.NotBlank;

@Getter
@Setter
public class UpdateSampleIsNeedReturnCmd {
    @ApiModelProperty("样品单id")
    @NotBlank
    private String id;

    @ApiModelProperty("样品是否需要退回。0 不需要，1 需要")
    @NotBlank
    private String sampleIsNeedReturn;
}
