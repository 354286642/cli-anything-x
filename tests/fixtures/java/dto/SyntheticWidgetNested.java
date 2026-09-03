package com.fixture.synthetic.dto;

import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SyntheticWidgetNested {

    @ApiModelProperty("嵌套标签")
    private String label;

    private Boolean active;
}