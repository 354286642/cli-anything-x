package com.example.sample.sample.domain.enums;

import com.google.common.collect.ImmutableSet;
import com.example.sample.main.constant.SampleOrderWarehouseTypeEnum;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Set;

@AllArgsConstructor
public enum SampleWarehouseTypeEnum {

    DM_WAREHOUSE("中心大贸仓", SampleOrderWarehouseTypeEnum.DM_WAREHOUSE, "中心大贸仓"), // 目前有10多个
    RETURN_GOOD_WAREHOUSE("国际退货仓(正品)", SampleOrderWarehouseTypeEnum.RETURN_OR_EXTERNAL_WAREHOUSE, "(正品)丰树国际退货仓"), // 目前一个
    RETURN_BAD_WAREHOUSE("国际退货仓(残品)", SampleOrderWarehouseTypeEnum.RETURN_OR_EXTERNAL_WAREHOUSE, "(残品)丰树国际退货仓"), // 目前一个
    EXTERNAL_SAMPLE_WAREHOUSE("外采仓", SampleOrderWarehouseTypeEnum.RETURN_OR_EXTERNAL_WAREHOUSE, "丰树国际外采样品仓"), // 目前一个
    OFFICE_SAMPLE_WAREHOUSE("办公室", SampleOrderWarehouseTypeEnum.OFFICE_SAMPLE_WAREHOUSE, ""); // 目前2个

    @Getter
    private final String name;
    @Getter
    private final SampleOrderWarehouseTypeEnum omsType;
    /**
     * 导入样品时，填入的仓库名称，因为是产品自定义的，所以特殊配置下
     */
    @Getter
    private final String importSampleOrderWarehouseName;

    public static SampleWarehouseTypeEnum parseImportSampleOrderWarehouseName(String name) {
        for (SampleWarehouseTypeEnum module : SampleWarehouseTypeEnum.values()) {
            if (module.getImportSampleOrderWarehouseName().equals(name)) {
                return module;
            }
        }
        return null;
    }

    /***
     * 合并为爱心纸条发货的仓库类型
     */
    public static final Set<SampleWarehouseTypeEnum> MERGE_DELIVERY_SET = ImmutableSet.of(RETURN_GOOD_WAREHOUSE, RETURN_BAD_WAREHOUSE, EXTERNAL_SAMPLE_WAREHOUSE);


}