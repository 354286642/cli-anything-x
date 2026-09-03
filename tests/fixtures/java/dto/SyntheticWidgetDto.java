package com.fixture.synthetic.dto;

import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * 合成 DTO：覆盖嵌套对象解析。
 */
@Getter
@Setter
public class SyntheticWidgetDto {

    @ApiModelProperty("部件名称")
    private String name;

    @ApiModelProperty("数量")
    private Integer count;

    @ApiModelProperty("嵌套部件")
    private SyntheticWidgetNested nested;
}