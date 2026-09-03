package com.example.sample.sample.dto.query;

import com.google.common.collect.Lists;
import com.example.sample.common.constants.LaunchPlatformEnum;
import com.example.sample.sample.domain.enums.SampleOrderLocationEnum;
import com.example.sample.sample.domain.enums.SampleOrderReturnStatusEnum;
import com.example.sample.sample.domain.enums.SampleOrderStatusEnum;
import com.example.sample.sample.domain.enums.SampleOrderTypeEnum;
import com.example.sample.common.dto.Query;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;
import java.util.List;

/**
 * Description: 样品
 *
 * @version 2025-01-24
 */
@Getter
@Setter
public class SampleOrderQuery extends Query {

    @ApiModelProperty("支持多个样品ID搜索")
    private List<String> ids;

    @ApiModelProperty("样品单号")
    private String code;

    @ApiModelProperty("领用用途二级分类id")
    private Integer subPurposeId;

    @ApiModelProperty("领用用途二级分类id,支持多个")
    private List<Integer> subPurposeIdList;

    @ApiModelProperty("当领用用途为客户时，对应平台客户ID")
    private String customerPlatformId;

    @ApiModelProperty("当领用用途为客户或直播间时，对应的平台")
    private LaunchPlatformEnum platform;
    @ApiModelProperty("平台，支持多个")
    private List<LaunchPlatformEnum> platformList;

    @ApiModelProperty("当领用用途为自播时，对应自播间ID")
    private String selfRoomId;

    @ApiModelProperty("商品编码,多个")
    private List<String> itemCodeList;

    @ApiModelProperty(value = "商品编码,权限控制", hidden = true)
    private List<String> itemCodePermissionList;

    @ApiModelProperty("样品的样品所在地；仓库、办公室")
    private SampleOrderLocationEnum sampleLocation;

    @ApiModelProperty("样品状态多个同时查询")
    private List<SampleOrderStatusEnum> statusList;

    @ApiModelProperty("样品类型,支持多个；WAREHOUSE_SEND 从仓库直接寄出（所在地仓库），COMPANY_PUBLIC_MAIL_SEND送至公司后公件寄出（所在地仓库），COMPANY_SELF_SEND 送至公司后自行寄出（所在地仓库），COMPANY_NO_SEND送至公司后无需邮寄（所在地仓库），PUBLIC_MAIL_SEND公件寄出（所在地办公室），SELF_SEND 自行寄出（所在地办公室），NO_SEND无需邮寄（所在地办公室）")
    private List<SampleOrderTypeEnum> itemTypeList;

    @ApiModelProperty("样品创建人")
    private String createBy;
    @ApiModelProperty("样品创建人.支持多个")
    private List<String> createByList;

    @ApiModelProperty("样品创建开始时间")
    private Date createTimeStart;
    @ApiModelProperty("样品创建结束时间")
    private Date createTimeEnd;

    @ApiModelProperty("物流单号")
    private String trackingNo;
    @ApiModelProperty("OA流程单号")
    private String oaProcessCode;

    @ApiModelProperty(value = "支持多个样品单id搜索", hidden = true)
    private List<String> sampleOrderIds = Lists.newArrayList();

    @ApiModelProperty("商品信息搜索。支持完整匹配条形码，模糊搜索商品名称")
    private String commodityInfo;

    @ApiModelProperty("样品的退回状态。")
    private SampleOrderReturnStatusEnum returnStatus;

    @ApiModelProperty("发起审核的人")
    private String auditCreateBy;

    @ApiModelProperty("达播商务，支持多个")
    private List<String> daboBusinessList;
    @ApiModelProperty("物流异常状态。0 否（样品单所有物流均无异常或已忽略），1 是（样品单所有物流存在任意一个异常的）")
    private String deliveryExceptionStatus;

    @ApiModelProperty("收货人联系方式。 支持英文逗号分隔多个")
    private String consigneePhone;

    @ApiModelProperty(value = "收货人联系方式.内部处理搜索", hidden = true)
    private List<String> consigneePhoneList;

    @ApiModelProperty(value = "样品状态查询，后台赋值使用", hidden = true)
    private List<SampleOrderStatusEnum> defaultStatusList;

    @ApiModelProperty(value = "领用用途状态查询，后台赋值使用", hidden = true)
    private List<Integer> defaultSubPurposeIdList;

    //是否仅查询基础数据。 高级审核的时候，查询分页数据，只查询基础数据，不再进行商品，物流等数据的匹配，减少数据查询
    @ApiModelProperty(value = "是否仅查询基础数据", hidden = true)
    private Boolean izQueryBaseData;


    @ApiModelProperty(value = "多个客户id搜索", hidden = true)
    private List<String> customerPlatformIds;

    @ApiModelProperty("发货时间-开始时间")
    private Date shippedDateStart;

    @ApiModelProperty("发货时间-结束时间")
    private Date shippedDateEnd;

    @ApiModelProperty("分组单号. 支持英文逗号分隔多个")
    private String planCode;

    @ApiModelProperty(value = "隐藏的分组id列表", hidden = true)
    private List<String> groupIdList;

}