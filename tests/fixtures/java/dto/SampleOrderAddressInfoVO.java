package com.example.sample.sample.dto.viewobject;

import com.example.sample.common.dto.ViewObject;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;
import org.apache.commons.lang3.StringUtils;

@Getter
@Setter
public class SampleOrderAddressInfoVO extends ViewObject {

    @ApiModelProperty("姓名")
    private String name;

    @ApiModelProperty("联系方式")
    private String mobile;

    @ApiModelProperty("详细地址")
    private String address;

    @ApiModelProperty("省")
    private String province;
    @ApiModelProperty("市")
    private String city;
    @ApiModelProperty("县区")
    private String area;

    @ApiModelProperty("是否系统解析的地址和录入的原文本有差异，仅对比详细地址。如果有差异返回true")
    private Boolean izParseDiff;


    /***
     * 如果省市区任意一个为空，返回true
     */
    public boolean izParseEmptyArea() {
        return StringUtils.isBlank(province) || StringUtils.isBlank(city) || StringUtils.isBlank(area);
    }

    public String formatAddress() {
        return (province != null ? province : "")
                + (city != null ? city : "")
                + (area != null ? area : "")
                + (address != null ? address : "");
    }
}