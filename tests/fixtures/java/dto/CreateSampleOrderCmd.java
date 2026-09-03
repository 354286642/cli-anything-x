package com.example.sample.sample.dto.command;

import com.example.sample.sample.domain.enums.SampleOrderCompanyExpressRequirementEnum;
import com.example.sample.sample.domain.enums.SampleOrderLocationEnum;
import com.example.sample.sample.domain.enums.SampleOrderTypeEnum;
import com.example.sample.common.dto.Command;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import java.util.List;

/**
 * Description: 样品
 *
 * @version 2025-01-24
 */
@Getter
@Setter
public class CreateSampleOrderCmd extends Command {

    @ApiModelProperty("0 保存草稿，1 保存并确认需求")
    @NotBlank
    private String isConfirm;

    @ApiModelProperty("同一批次保存的样品单明细")
    private List<CreateSampleOrderDetailsCmd> detailsList;

    @ApiModelProperty("商品编码")
    @NotBlank
    private String itemCode;

     @ApiModelProperty("样品的样品所在地；仓库、办公室")
     @NotNull
     private SampleOrderLocationEnum sampleLocation;

    @ApiModelProperty("样品所在地为办公室时（从办公室领用），办公室对应的仓库编码。")
    private String sourceCode;

     @ApiModelProperty("样品类型")
     @NotNull
     private SampleOrderTypeEnum itemType;

     @ApiModelProperty("公司收货人姓名。 寄到公司时有值")
     private String companyConsigneeName;

     @ApiModelProperty("公司收货人联系方式。 寄到公司时有值")
     private String companyConsigneePhone;

     @ApiModelProperty("公司收货人地址。 不包括省市区。寄到公司时有值")
     private String companyConsigneeAddress;
    @ApiModelProperty("公司收货人省")
    private String companyConsigneeProvince;
    @ApiModelProperty("公司收货人市")
    private String companyConsigneeCity;
    @ApiModelProperty("公司收货人县区")
    private String companyConsigneeArea;
    @ApiModelProperty("送至公司物流要求；仓库寄到公司时有值")
    private SampleOrderCompanyExpressRequirementEnum companyExpressRequirement;


    public void emptyCompanyConsignee() {
        this.companyConsigneeName = null;
        this.companyConsigneePhone = null;
        this.companyConsigneeAddress = null;
        this.companyConsigneeProvince = null;
        this.companyConsigneeCity = null;
        this.companyConsigneeArea = null;
    }
}