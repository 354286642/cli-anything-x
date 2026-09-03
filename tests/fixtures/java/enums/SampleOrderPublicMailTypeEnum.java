package com.example.sample.sample.domain.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/***
 * 样品公件类型 .  字典：dict_sample_order_public_mail_type
 * 公件类型：仓库/办公室公件寄出时需要填写，默认长沙国内件，可选长沙国际件、上海寄出
 */
@AllArgsConstructor
public enum SampleOrderPublicMailTypeEnum {

    CS_DOMESTIC("长沙国内件"),
    CS_INTERNATIONAL("长沙国际件"),
    SHANGHAI_SENT("上海寄出");

    @Getter
    private final String name;

    public static SampleOrderPublicMailTypeEnum parseValue(String name) {
        for (SampleOrderPublicMailTypeEnum module : SampleOrderPublicMailTypeEnum.values()) {
            if (module.getName().equals(name)) {
                return module;
            }
        }
        return null;
    }
}
