package com.example.sample.planpayment.dto.command;

import com.example.sample.common.dto.Command;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import javax.validation.constraints.NotBlank;

@Getter
@Setter
public class ParsePaymentInfoCmd extends Command {

    @ApiModelProperty("粘贴的文本内容")
    @NotBlank
    private String text;
}
