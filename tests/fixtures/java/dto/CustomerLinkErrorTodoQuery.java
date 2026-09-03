package com.example.sample.customer.dto.query;

import com.example.sample.common.constants.PlatformEnum;
import com.example.sample.customer.domain.model.enums.CustomerPlatformDetailStatusEnum;
import com.example.sample.common.dto.Query;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class CustomerLinkErrorTodoQuery extends Query {

    @ApiModelProperty("客户昵称")
    private String accountName;

    @ApiModelProperty(value = "平台列表")
    private List<PlatformEnum> platformList;

    @ApiModelProperty("客户id")
    private String accountId;

    @ApiModelProperty("创建人, 传id")
    private String createBy;

    @ApiModelProperty("关联分组编码")
    private String code;

    @ApiModelProperty("异常原因")
    private CustomerPlatformDetailStatusEnum status;

    @ApiModelProperty(value = "处理人id", hidden = true)
    private String userId;
    @ApiModelProperty(value = "平台客户IDList", hidden = true)
    private List<String> customerPlatformIdList;

}