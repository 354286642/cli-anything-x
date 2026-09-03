package com.example.sample.sample.domain.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/***
 *  样品物流要求(适用于仓库直接寄出，公件物流要求); 字典：dict_sample_order_express_requirement
 */
@AllArgsConstructor
public enum SampleOrderExpressRequirementEnum {

    SFDSBK("顺丰电商标快"),
    SFTK("顺丰特快"),
    PT("普通物流"),
    ANKY("安能快运标准");


    @Getter
    private final String name;

    public static SampleOrderExpressRequirementEnum parseValue(String name) {
        for (SampleOrderExpressRequirementEnum module : SampleOrderExpressRequirementEnum.values()) {
            if (module.getName().equals(name)) {
                return module;
            }
        }
        return null;
    }
}
