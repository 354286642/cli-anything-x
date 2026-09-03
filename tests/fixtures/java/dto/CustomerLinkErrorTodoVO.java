package com.example.sample.customer.dto.vo;

import com.example.sample.common.constants.PlatformEnum;
import com.example.sample.customer.domain.model.enums.CustomerPlatformDetailStatusEnum;
import com.example.sample.common.dto.ViewObject;
import com.example.sample.framework.biz.convert.Converted;
import com.example.sample.service.api.UserApi;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;
import java.util.List;

@Getter
@Setter
public class CustomerLinkErrorTodoVO extends ViewObject {

    @ApiModelProperty("id")
    private String id;

    @ApiModelProperty(value = "平台")
    private PlatformEnum platform;
    @ApiModelProperty("平台名称")
    @Converted(dependProperty = "platform", type = "dict_launch_platform")
    private String platformName;

    @ApiModelProperty("客户昵称")
    private String accountName;
    @ApiModelProperty("主页链接")
    private String homePageUrl;
    @ApiModelProperty("帐号ID")
    private String accountId;

    @ApiModelProperty("平台客户ID")
    private String customerPlatformId;

    @ApiModelProperty("异常原因")
    private CustomerPlatformDetailStatusEnum status;
    @Converted(dependProperty = "status", type = "dict_customer_status")
    private String statusName;

    @ApiModelProperty("异常来源")
    private String exceptionSourceType;
    @Converted(dependProperty = "exceptionSourceType", type = "todo_exception_source_type")
    private String exceptionSource;
    @ApiModelProperty("补录来源文件名")
    private String fileName;
    @ApiModelProperty("补录来源文件下载路径")
    private String fileUrl;
    @ApiModelProperty("关联分组列表")
    private List<CustomerLinkErrorPlanVO> planList;

    @ApiModelProperty("创建时间")
    private Date createDate;

    @ApiModelProperty("创建人")
    private String createBy;
    @ApiModelProperty("创建人姓名")
    @Converted(dependProperty = "createBy", feign = UserApi.class)
    private String createByName;

}