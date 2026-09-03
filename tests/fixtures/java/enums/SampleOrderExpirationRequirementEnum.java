package com.example.sample.sample.domain.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/***
 *  样品效期要求； 字典：dict_sample_order_expiration_requirement
 */
@AllArgsConstructor
public enum SampleOrderExpirationRequirementEnum {

    BAD_INVENTORY("不良品库存"),
    WITHIN_12_MONTHS("12个月内"),
    BETWEEN_12_AND_24_MONTHS("12-24个月"),
    BETWEEN_24_AND_30_MONTHS("24-30个月"),
    OVER_30_MONTHS("30个月以上");


    @Getter
    private final String name;

    public static SampleOrderExpirationRequirementEnum parseValue(String name) {
        for (SampleOrderExpirationRequirementEnum module : SampleOrderExpirationRequirementEnum.values()) {
            if (module.getName().equals(name)) {
                return module;
            }
        }
        return null;
    }
}
