package com.example.sample.sample.domain.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/***
 *  样品样品所在地  字典：dict_sample_location
 */
@AllArgsConstructor
public enum SampleOrderLocationEnum {

    WAREHOUSE("仓库"),
    OFFICE("办公室");

    @Getter
    private final String name;
}
