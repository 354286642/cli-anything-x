package com.fixture.synthetic;

import com.fixture.synthetic.dto.SyntheticWidgetDto;
import io.swagger.annotations.ApiOperation;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 合成夹具：补齐真实控制器未覆盖的解析面。
 * 覆盖点：DELETE 映射、@PathVariable（带/不带 name）、@PatchMapping、
 * 类级与方法级 @RequestMapping(value = {...}) 多路径数组、
 * @RequestMapping(method = RequestMethod.XXX)、方法级 ${} 占位符、
 * @RequestParam(required = false, defaultValue = ...)、OpenAPI3 @Operation(summary)。
 */
@RestController
@RequestMapping(value = {"/${fixture.api.prefix}/synthetic", "/syntheticAlias"})
public class SyntheticCoverageController {

    @DeleteMapping("/remove/{id}")
    @ApiOperation(value = "按路径参数删除")
    public void removeById(@PathVariable("id") String id) {
    }

    @GetMapping("/detail/{code}")
    @ApiOperation(value = "按路径参数查详情（PathVariable 省略 name）")
    public SyntheticWidgetDto detailByCode(@PathVariable String code) {
        return null;
    }

    @GetMapping({"/multiPathA", "/multiPathB"})
    @Operation(summary = "OpenAPI3 summary 回退")
    public SyntheticWidgetDto multiPath(
            @RequestParam(value = "pageNo", required = false, defaultValue = "1") Integer pageNo,
            @RequestParam(value = "keyword", required = false) String keyword) {
        return null;
    }

    @RequestMapping(value = {"/viaMappingA", "/viaMappingB"}, method = RequestMethod.GET)
    @ApiOperation(value = "RequestMapping 多路径数组 + method 属性")
    public String viaRequestMappingMultiPath() {
        return "ok";
    }

    @RequestMapping(value = "/putViaRequestMapping", method = RequestMethod.PUT)
    @ApiOperation(value = "RequestMapping method=PUT")
    public void putViaRequestMapping(@RequestBody SyntheticWidgetDto dto) {
    }

    @PostMapping("${fixture.subPath}/echo")
    @ApiOperation(value = "方法级占位符")
    public SyntheticWidgetDto echoWithPlaceholder(@RequestBody SyntheticWidgetDto dto) {
        return dto;
    }

    @PatchMapping("patchStatus")
    @ApiOperation(value = "PATCH 映射")
    public void patchStatus(@RequestParam String id) {
    }

    @GetMapping("queryWithDefault")
    @ApiOperation(value = "默认值与必填混合")
    public String queryWithDefault(
            @RequestParam String name,
            @RequestParam(required = false, defaultValue = "20") Integer pageSize) {
        return name;
    }
}