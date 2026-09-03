package com.fixture.synthetic;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 合成夹具：独立 Controller 保证 Javadoc 描述回退路径被干净命中
 * （方法前后无 @ApiOperation/@Operation 干扰）。
 */
@RestController
@RequestMapping("/javadocOnly")
public class JavadocOnlyController {

    /**
     * Javadoc 描述回退
     */
    @GetMapping("describe")
    public String describe(@RequestParam String flag) {
        return flag;
    }
}