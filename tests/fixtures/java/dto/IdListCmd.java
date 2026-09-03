package com.example.sample.common.dto.command;

import com.example.sample.common.dto.Command;
import io.swagger.annotations.ApiModelProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.NotNull;
import java.util.List;

/**
 * @Name
 * @Description
 * @date 2022/8/5
 */
@Getter
@Setter
@Builder
@AllArgsConstructor
public class IdListCmd extends Command {

    @NotEmpty
    @ApiModelProperty("ids")
    @NotNull
    private List<String> ids;

}
