package com.example.sample.sample.dto.command;

import lombok.Getter;
import lombok.Setter;

import javax.validation.constraints.NotBlank;


/**
 * Description: 样品
 *
 * @version 2025-01-24
 */
@Getter
@Setter
public class UpdateSampleOrderCmd extends CreateSampleOrderCmd {

    @NotBlank
    private String id;

}