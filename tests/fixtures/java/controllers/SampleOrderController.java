package com.example.sample.web;

import com.example.sample.common.command.IdListCmd;
import com.example.sample.common.command.ParsePaymentInfoCmd;
import com.example.sample.common.dto.BaseResult;
import com.example.sample.common.dto.PageRequest;
import com.example.sample.logistics.dto.query.DeliveryCompanyQuery;
import com.example.sample.logistics.dto.vo.DeliveryCompanyVO;
import com.example.sample.order.application.command.SampleOrderService;
import com.example.sample.order.application.query.SampleOrderQueryService;
import com.example.sample.order.dto.command.CancelSampleOrderCmd;
import com.example.sample.order.dto.command.CreateSampleOrderCmd;
import com.example.sample.order.dto.command.ManualSampleOrderDeliveryCmd;
import com.example.sample.order.dto.command.SampleOrderManualSignCmd;
import com.example.sample.order.dto.command.UpdateSampleIsNeedReturnCmd;
import com.example.sample.order.dto.command.UpdateSampleOrderCmd;
import com.example.sample.order.dto.query.SampleOrderQuery;
import com.example.sample.order.dto.viewobject.CustomerRepeatSampleOrderVO;
import com.example.sample.order.dto.viewobject.ManualSampleOrderDeliveryVO;
import com.example.sample.order.dto.viewobject.SampleOrderAddressInfoVO;
import com.example.sample.order.dto.viewobject.SampleOrderDetailsVO;
import com.example.sample.order.dto.viewobject.SampleOrderPurposeConfigVO;
import com.example.sample.order.dto.viewobject.SampleOrderStatVO;
import com.example.sample.order.dto.viewobject.SampleOrderStatusCountVO;
import com.example.sample.order.dto.viewobject.SampleOrderVO;
import com.example.sample.relation.dto.query.CustomerLinkErrorTodoQuery;
import com.example.sample.relation.dto.vo.CustomerLinkErrorTodoVO;
import com.github.pagehelper.PageInfo;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Set;

/**
 * 样品单（SampleOrder）示例 Controller —— 纯合成夹具，用于 Java 解析器表征测试。
 * 覆盖：类级 ${api.prefix} 占位符、POST/GET 映射、@ApiOperation、
 * PageRequest&lt;T&gt; 泛型请求、带/不带属性的 @RequestParam、@ApiParam、
 * 泛型返回类型展开等解析面。所有类名、字段与描述均为虚构。
 */
@RestController
@RequestMapping(value = "/${api.prefix}/sampleOrder")
@Api(tags = "样品单")
public class SampleOrderController {

    @PostMapping("listPage")
    @ApiOperation(value = "样品单列表")
    public PageInfo<SampleOrderVO> listPage(@RequestBody PageRequest<SampleOrderQuery> request) {
        return null;
    }

    @PostMapping("listStatusCount")
    @ApiOperation(value = "获取状态统计数")
    public List<SampleOrderStatusCountVO> listStatusCount(@RequestBody SampleOrderQuery query) {
        return null;
    }

    @PostMapping("listPurposeConfig")
    @ApiOperation(value = "获取领用用途配置")
    public List<SampleOrderPurposeConfigVO> listPurposeConfig() {
        return null;
    }

    @PostMapping("create")
    @ApiOperation(value = "创建样品单，返回保存的多条样品单 ID")
    public List<String> create(@RequestBody CreateSampleOrderCmd createSampleOrderCmd) {
        return null;
    }

    @PostMapping("update")
    @ApiOperation(value = "修改样品单")
    public void update(@RequestBody UpdateSampleOrderCmd updateSampleOrderCmd) {
    }

    @PostMapping("checkAddressSimilar")
    @ApiOperation(value = "检验地址相似度")
    public Set<String> checkAddressSimilar(@RequestBody List<String> addressList) {
        return null;
    }

    @PostMapping("ignoreException")
    @ApiOperation(value = "忽略样品单物流异常")
    public void ignoreException(@RequestParam(name = "trackingNo") @ApiParam("物流单号") String trackingNo) {
    }

    @PostMapping("parseAddress")
    @ApiOperation(value = "解析收货地址")
    public SampleOrderAddressInfoVO parseAddress(@RequestBody ParsePaymentInfoCmd cmd) {
        return null;
    }

    @PostMapping("getLastCompanyConsigneeInfo")
    @ApiOperation(value = "获取当前用户最后一次录入的公司收货人信息")
    public SampleOrderAddressInfoVO getLastCompanyConsigneeInfo() {
        return null;
    }

    @GetMapping("getDetails")
    @ApiOperation(value = "样品单详情")
    public SampleOrderDetailsVO getDetails(@RequestParam String id) {
        return null;
    }

    @GetMapping("getDetailsByUpdate")
    @ApiOperation(value = "样品单编辑信息")
    public SampleOrderVO getDetailsByUpdate(@RequestParam String id) {
        return null;
    }

    @PostMapping("updateSampleIsNeedReturn")
    @ApiOperation(value = "修改样品是否需要退回")
    public void updateSampleIsNeedReturn(@RequestBody UpdateSampleIsNeedReturnCmd cmd) {
    }

    @PostMapping("cancelSampleOrder")
    @ApiOperation(value = "作废样品单；草稿、待提审状态下的作废")
    public void cancelSampleOrder(@RequestParam String id) {
    }

    @PostMapping("batchCancelSampleOrder")
    @ApiOperation(value = "批量作废样品单；草稿、待提审状态下的作废")
    public void batchCancelSampleOrder(@RequestBody IdListCmd cmd) {
    }

    @PostMapping("addDelivery")
    @ApiOperation(value = "手动新增物流单号")
    public void addDelivery(@RequestBody ManualSampleOrderDeliveryCmd cmd) {
    }

    @PostMapping("updateDelivery")
    @ApiOperation(value = "手动更新物流单号")
    public void updateDelivery(@RequestBody ManualSampleOrderDeliveryCmd cmd) {
    }

    @PostMapping("listAllDeliveryCompany")
    @ApiOperation(value = "获取所有物流公司，不分页")
    public List<DeliveryCompanyVO> listAllDeliveryCompany() {
        return null;
    }

    @PostMapping("checkCustomerRepeatSampleOrder")
    @ApiOperation(value = "校验客户是否有重复样品单")
    public CustomerRepeatSampleOrderVO checkCustomerRepeatSampleOrder(@RequestParam String customerId) {
        return null;
    }

    @PostMapping("exportSampleOrder")
    @ApiOperation(value = "导出样品单信息")
    public BaseResult<String> exportSampleOrder(@RequestBody SampleOrderQuery query) {
        return null;
    }

    @PostMapping("importSampleOrder")
    @ApiOperation(value = "导入样品单信息")
    public List<SampleOrderVO> importSampleOrder(
            MultipartFile file,
            @RequestParam(value = "sourceCode", required = false)
            @ApiParam(value = "如果导入时选择的是从办公室领用，则需要指定办公室编码") String sourceCode) {
        return null;
    }

    @PostMapping("errorTodoList")
    @ApiOperation(value = "客户主页链接异常待办列表")
    public PageInfo<CustomerLinkErrorTodoVO> errorTodoList(
            @RequestBody PageRequest<CustomerLinkErrorTodoQuery> request) {
        return null;
    }

    @PostMapping("batchConfirm")
    @ApiOperation(value = "批量确认需求，仅会确认草稿状态的")
    public String batchConfirm(@RequestBody IdListCmd cmd) {
        return null;
    }

    @PostMapping("getStatData")
    @ApiOperation(value = "获取样品单统计数据")
    public SampleOrderStatVO getStatData(@RequestBody SampleOrderQuery query) {
        return null;
    }

    @PostMapping("updateSampleOrderDelivery")
    @ApiOperation(value = "更新物流信息，单个更新")
    public void updateSampleOrderDelivery(@RequestBody ManualSampleOrderDeliveryVO deliveryVO) {
    }

    @PostMapping("updateSampleOrderNoSend")
    @ApiOperation(value = "修改样品单为无需邮寄；传样品单 id")
    public void updateSampleOrderNoSend(
            @RequestParam(name = "id") @ApiParam("样品 id") String id) {
    }

    @PostMapping("manualSign")
    @ApiOperation(value = "手动签收物流单")
    public void manualSign(@RequestBody SampleOrderManualSignCmd manualSignCmd) {
    }

    @PostMapping("cancelSampleOrderByCmd")
    @ApiOperation(value = "取消样品单，待发货状态下")
    public void cancelSampleOrderByCmd(@RequestBody CancelSampleOrderCmd cmd) {
    }
}
