package com.example.sample.sample.domain.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/***
 *  样品物流要求(适用于送到公司); 字典：dict_sample_order_company_express_requirement
 *
 */
@AllArgsConstructor
public enum SampleOrderCompanyExpressRequirementEnum {

    SFDSBK("顺丰电商标快送至公司"),
    SFTK("顺丰特快送至公司"),
    PT("普通物流送至公司"),
    SYZT("小邮局自提"),
    ANKY("安能快运标准");


    @Getter
    private final String name;

    public static SampleOrderCompanyExpressRequirementEnum parseValue(String name) {
        for (SampleOrderCompanyExpressRequirementEnum module : SampleOrderCompanyExpressRequirementEnum.values()) {
            if (module.getName().equals(name)) {
                return module;
            }
        }
        return null;
    }
}
