package com.example.sample.sample.dto.viewobject;

import com.alibaba.fastjson.annotation.JSONField;
import com.example.sample.common.application.query.UserQueryService;
import com.example.sample.common.bizchangelog.ChangeField;
import com.example.sample.common.constants.LaunchPlatformEnum;
import com.example.sample.launch.domain.enums.LaunchProjectTypeEnum;
import com.example.sample.sample.domain.enums.SampleOrderCompanyExpressRequirementEnum;
import com.example.sample.sample.domain.enums.SampleOrderExpressRequirementEnum;
import com.example.sample.sample.domain.enums.SampleOrderLocationEnum;
import com.example.sample.sample.domain.enums.SampleOrderOaAuditStatusEnum;
import com.example.sample.sample.domain.enums.SampleOrderPublicMailTypeEnum;
import com.example.sample.sample.domain.enums.SampleOrderPurposeTypeEnum;
import com.example.sample.sample.domain.enums.SampleOrderReturnStatusEnum;
import com.example.sample.sample.domain.enums.SampleOrderStatusEnum;
import com.example.sample.sample.domain.enums.SampleOrderTypeEnum;
import com.example.sample.sample.domain.model.entity.SampleOrderAudit;
import com.example.sample.selflive.domain.repository.SelfLiveRoomInfoRepository;
import com.example.sample.customer.domain.repository.McnInfoRepository;
import com.example.sample.customer.domain.repository.CustomerPlatformDetailRepository;
import com.example.sample.common.dto.ViewObject;
import com.example.sample.data.api.BrandApi;
import com.example.sample.framework.biz.convert.Converted;
import com.example.sample.service.api.UserApi;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;
import org.apache.commons.lang3.StringUtils;

import java.util.Date;
import java.util.List;

@Getter
@Setter
public class SampleOrderVO extends ViewObject {

    private String id;

    @ApiModelProperty("关联分组id")
    private String groupId;

    @ApiModelProperty("样品单号")
    private String code;

    @ApiModelProperty("领用用途二级分类id")
    private Integer subPurposeId;

    @ApiModelProperty("领用用途父类名称")
    private String purposeName;
    @ApiModelProperty("领用用途子类名称")
    private String subPurposeName;

    @ApiModelProperty("领用用途子类类型")
    private SampleOrderPurposeTypeEnum subPurposeType;

    @ApiModelProperty("领用用途的详细描述。目前适用于退货时选择样品单显示。格式：样品单号（领用用途父类名称>领用用途子类名称>客户or自播间or详细描述）")
    private String purposeDetailDesc;

    @ApiModelProperty("当领用用途为客户时，对应平台客户ID")
    private String customerPlatformId;

    @ApiModelProperty("当导入客户样品信息，主页链接存在时，导入数据时原样返回客户主页链接")
    private String homePageUrl;
    @ApiModelProperty("当领用用途为客户时，对应的客户昵称")
    @Converted(dependProperty = "customerPlatformId", feign = CustomerPlatformDetailRepository.class, refLabel = "accountName")
    private String customerAccountName;
    @ApiModelProperty("当领用用途为客户时，对应的客户账号id。如抖音号")
    @Converted(dependProperty = "customerPlatformId", feign = CustomerPlatformDetailRepository.class, refLabel = "accountId")
    private String customerAccountId;
    @ApiModelProperty("当领用用途为客户时，对应的客户头像")
    private String customerIcon;

    @ApiModelProperty("当领用用途为客户或直播间时，对应的平台")
    private LaunchPlatformEnum platform;

    @ApiModelProperty("当领用用途为客户或直播间时，对应的平台")
    @Converted(dependProperty = "platform", type = "dict_launch_platform")
    private String platformName;

    @ApiModelProperty("当领用用途为自播时，对应自播间ID")
    private String selfRoomId;
    @Converted(dependProperty = "selfRoomId", feign = SelfLiveRoomInfoRepository.class)
    private String selfRoomName;

    @ApiModelProperty("当领用用途为MCN机构时，对应的mcn_info的主键id")
    private String mcnInfoId;
    @ApiModelProperty("当领用用途为MCN机构时，对应的mcn机构简称")
    @Converted(dependProperty = "mcnInfoId", feign = McnInfoRepository.class, refLabel = "shortName")
    private String mcnInfoShortName;

    @ApiModelProperty("领用用途选办公室备样时，对应的办公室编码")
    private String purposeOfficeWarehouseCode;

    @ApiModelProperty("领用用途选办公室备样时，对应的办公室名称")
    private String purposeOfficeWarehouseName;

    @ApiModelProperty("当领用用途不为客户和自播时，对应的具体描述。如活动名称、需求名称、公关原因")
    private String purposeDesc;

    @ApiModelProperty("商品编码")
    private String itemCode;

    @ApiModelProperty("商品名称")
    @Converted(dependProperty = "itemCode", feign = BrandApi.class, refMethod = "liteBrandByCodes", refKey = "code")
    private String brandName;

    @ApiModelProperty("商品logo")
    @Converted(dependProperty = "itemCode", feign = BrandApi.class, refMethod = "liteBrandByCodes", refKey = "code", refLabel = "logoUrl")
    private String brandLogoUrl;

    @ApiModelProperty("商品财务组织架构编码。1000 股份，1001 国际")
    @Converted(dependProperty = "itemCode", feign = BrandApi.class, refMethod = "liteBrandByCodes", refKey = "code", refLabel = "financeOrgLevel1")
    private String brandFinanceOrgLevel1;

    @ApiModelProperty("样品类型")
    private SampleOrderTypeEnum itemType;

    @ApiModelProperty("样品类型名称")
    @Converted(dependProperty = "itemType", type = "dict_sample_order_type")
    private String itemTypeName;

    @ApiModelProperty("样品的样品所在地；仓库、办公室")
    private SampleOrderLocationEnum sampleLocation;

    @ApiModelProperty("样品的样品所在地；仓库、办公室")
    @Converted(dependProperty = "sampleLocation", type = "dict_sample_location")
    private String sampleLocationName;

    @ApiModelProperty("样品所在地为办公室时（从办公室领用），办公室对应的仓库编码")
    private String sourceCode;

    @ApiModelProperty("样品所在地为办公室时（从办公室领用），办公室对应的仓库名称")
    private String officeWarehouseName;

    @ApiModelProperty("样品单状态")
    private SampleOrderStatusEnum status;

    @ApiModelProperty("样品单状态")
    @Converted(dependProperty = "status", type = "dict_sample_order_status")
    private String statusName;

    @ApiModelProperty("OA的审核进展状态")
    private SampleOrderOaAuditStatusEnum oaAuditStatus;

    @ApiModelProperty("OA的审核进展状态")
    @Converted(dependProperty = "oaAuditStatus", type = "dict_sample_order_oa_audit_status")
    private String oaAuditStatusName;

    @ApiModelProperty("样品的物流情况，可能有多个")
    private List<SampleOrderDeliveryVO> sampleDeliveryList;

    @ApiModelProperty("样品对应的商品，可能有多个")
    private List<SampleOrderCommodityVO> sampleCommodityList;

    @ApiModelProperty("样品创建人ID")
    private String createBy;

    @ApiModelProperty("样品创建人名称")
    @Converted(dependProperty = "createBy", refMethod = "getNameMapByUserIdAndAccountId", feign = UserQueryService.class)
    private String createByName;

    @ApiModelProperty("样品创建人花名拼音")
    @Converted(dependProperty = "createBy", feign = UserApi.class, refLabel = "loginName")
    private String createByLoginName;

    @ApiModelProperty("样品创建时间")
    private Date createDate;

    @ApiModelProperty("样品的退回状态。当样品需要退回时，有此状态")
    private SampleOrderReturnStatusEnum returnStatus;

    @ApiModelProperty("是否需要邮寄。1 需要邮寄。0 不需要邮寄")
    private String izNeedSendMail;

    @ApiModelProperty("公司收货人姓名。 寄到公司时有值")
    private String companyConsigneeName;
    @ApiModelProperty("公司收货人联系方式。 寄到公司时有值")
    private String companyConsigneePhone;
    @ApiModelProperty("公司收货人省。 寄到公司时有值")
    private String companyConsigneeProvince;
    @ApiModelProperty("公司收货人市。 寄到公司时有值")
    private String companyConsigneeCity;
    @ApiModelProperty("公司收货人县区。 寄到公司时有值")
    private String companyConsigneeArea;
    @ApiModelProperty("公司收货人地址。 不包括省市区。寄到公司时有值")
    private String companyConsigneeAddress;

    @ApiModelProperty("收货人姓名。 无需邮寄时为空")
    private String consigneeName;
    @ApiModelProperty("收货人联系方式。 无需邮寄时为空")
    private String consigneePhone;
    @ApiModelProperty("收货人省。 无需邮寄时为空")
    private String consigneeProvince;
    @ApiModelProperty("收货人市。 无需邮寄时为空")
    private String consigneeCity;
    @ApiModelProperty("收货人县区。 无需邮寄时为空")
    private String consigneeArea;
    @ApiModelProperty("收货人详细地址，不包括省市区。 无需邮寄时为空")
    private String consigneeAddress;

    @ApiModelProperty("物流要求。适用于仓库直接寄出，公件物流要求")
    private SampleOrderExpressRequirementEnum expressRequirement;

    @ApiModelProperty("物流要求名称。适用于仓库直接寄出，公件物流要求")
    @Converted(dependProperty = "expressRequirement", type = "dict_sample_order_express_requirement")
    private String expressRequirementName;

    @ApiModelProperty("送至公司物流要求")
    @ChangeField(name = "送至公司物流要求", refMethod = "getName")
    private SampleOrderCompanyExpressRequirementEnum companyExpressRequirement;

    @ApiModelProperty("送至公司物流要求名称")
    @Converted(dependProperty = "companyExpressRequirement", type = "dict_sample_order_company_express_requirement")
    private String companyExpressRequirementName;

    @ApiModelProperty("保价状态。0 不保价。1 保价")
    private String insureStatus;

    @ApiModelProperty("保价时填入的商品总金额")
    private java.math.BigDecimal insureGoodsAmt;

    @ApiModelProperty("实际保价金额。 保价商品金额/100")
    private java.math.BigDecimal insureAmt;

    @ApiModelProperty("样品是否需要退回。0 不需要，1 需要")
    private String sampleIsNeedReturn;

    @ApiModelProperty("其他备注")
    private String remark;

    @ApiModelProperty("备注给仓库的发货要求")
    private String warehouseRemark;

    @ApiModelProperty("OA流程编号。当有关联审核单时有此值。 可关联到sample_order_audit的oa_process_code")
    private String oaProcessCode;

    @ApiModelProperty("公件类型")
    private SampleOrderPublicMailTypeEnum publicMailType;

    @ApiModelProperty("公件类型")
    @Converted(dependProperty = "publicMailType", type = "dict_sample_order_public_mail_type")
    private String publicMailTypeName;

    @ApiModelProperty("公司地址json字符串。临时查询转换用")
    @JSONField(serialize = false)
    private String companyConsigneeAddressJsonStr;
    @ApiModelProperty("地址json字符串。临时查询转换用")
    @JSONField(serialize = false)
    private String consigneeAddressJsonStr;

    @ApiModelProperty("导入时的异常信息；多个异常逗号分隔拼接，当为批量导入样品信息时，如果某一行导入数据有异常信息，则累加到此字段。 行按地址合并后的数据来")
    private String importErrorMsg;

    @ApiModelProperty("导入时对应的execl数据行数。多行数据逗号分隔拼接。实际进入系统后，是根据收货地址等进行合并为一行，这里相当于是哪些excel行合并来的")
    private String excelRowIndexStr;

    @ApiModelProperty("OA返回的fdId，OA部分接口用此ID查询，如查询流程编码。也可以直接拼接url跳转OA")
    private String oaFdId;

    @ApiModelProperty("样品单首次签收时间")
    private Date firstSignedDate;

    @ApiModelProperty("批量导入样品单时，查询重复样品客户的信息")
    private CustomerRepeatSampleOrderVO customerRepeatSampleOrder;

    @ApiModelProperty("关联分组单号")
    private String planCode;

    @ApiModelProperty("分组类型")
    private LaunchProjectTypeEnum planType;

    /***
     * 初始化是否需要邮寄
     */
    public void initIzNeedSendMail() {
        if (SampleOrderTypeEnum.NOT_NEED_SEND_MAIL_SET.contains(itemType)) {
            izNeedSendMail = "0";
        } else {
            izNeedSendMail = "1";
        }
    }

    public void initOaAuditStatus(SampleOrderAudit sampleOrderAudit) {
        //草稿和已关闭时，不用赋值审核状态
        if (this.status == SampleOrderStatusEnum.DRAFT || this.status == SampleOrderStatusEnum.CLOSED) {
            return;
        }
        //待提审时,如果还没有关联到审核单，则审核状态为待提交审核
        if (this.status == SampleOrderStatusEnum.WAIT_SUBMIT && StringUtils.isBlank(this.oaProcessCode)) {
            this.oaAuditStatus = SampleOrderOaAuditStatusEnum.WAIT_SUBMIT;
            return;
        }
        if (sampleOrderAudit != null) {
            this.oaAuditStatus = sampleOrderAudit.getOaAuditStatus();
        }
    }

    public void initConsigneeAddress(AddressInfoVO consigneeAddressVO) {
        if (consigneeAddressVO == null) {
            return;
        }
        this.consigneeAddress = consigneeAddressVO.getAddress();
        this.consigneeArea = consigneeAddressVO.getArea();
        this.consigneeCity = consigneeAddressVO.getCity();
        this.consigneeProvince = consigneeAddressVO.getProvince();

    }

    public void initCompanyConsigneeAddress(AddressInfoVO companyConsigneeAddress) {
        if (companyConsigneeAddress == null) {
            return;
        }
        this.companyConsigneeAddress = companyConsigneeAddress.getAddress();
        this.companyConsigneeArea = companyConsigneeAddress.getArea();
        this.companyConsigneeCity = companyConsigneeAddress.getCity();
        this.companyConsigneeProvince = companyConsigneeAddress.getProvince();
    }


    /***
     *  拼接领用用途的详细描述。目前适用于退货时选择样品单显示。格式：样品单号（领用用途父类名称>领用用途子类名称>客户or自播间or办公室or详细描述）
     */
    public void initPurposeDetailDescStr() {
        //客户or自播间or办公室or详细描述
        String purposeDescStr;
        if (this.subPurposeType == SampleOrderPurposeTypeEnum.CUSTOMER) {
            purposeDescStr = this.customerAccountName;
        } else if (this.subPurposeType == SampleOrderPurposeTypeEnum.SELF) {
            purposeDescStr = this.selfRoomName;
        } else if (this.subPurposeType == SampleOrderPurposeTypeEnum.OFFICE) {
            purposeDescStr = this.purposeOfficeWarehouseName;
        } else if (this.subPurposeType == SampleOrderPurposeTypeEnum.MCN) {
            purposeDescStr = this.mcnInfoShortName;
        } else {
            purposeDescStr = this.purposeDesc;
        }
        this.purposeDetailDesc = String.format("%s(%s>%s>%s)", this.code, this.purposeName, this.subPurposeName, purposeDescStr);
    }
}