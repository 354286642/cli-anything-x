package com.example.sample.sample.dto.viewobject;

import com.example.sample.sample.domain.enums.SampleOrderPurposeTypeEnum;
import com.example.sample.common.dto.ViewObject;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/***
 * 样品领用用途配置json
 */
@Getter
@Setter
public class SampleOrderPurposeConfigVO extends ViewObject {

    @ApiModelProperty("名称，对外显示用")
    private String name;
    private Integer id;
    @ApiModelProperty("子类")
    private List<SampleOrderPurposeChildrenConfigVO> children;


    @Getter
    @Setter
    public static class SampleOrderPurposeChildrenConfigVO extends ViewObject {
        @ApiModelProperty("名称，对外显示用")
        private String name;
        private Integer id;
        @ApiModelProperty("customer 客户，self 直播间，activity 活动名称, requirement 需求名称, distributor 分销商名称， public 公关， service 售后，office 办公室")
        private SampleOrderPurposeTypeEnum type;
        @ApiModelProperty("描述，如：用于维护与客户的关系")
        private String desc;
    }
}
