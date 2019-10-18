import { Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { TypeormConfigService } from './typeorm-config.service';

@Module({
    providers: [
        {
            provide: ConfigService,
            useValue: new ConfigService(`${process.env.NODE_ENV || 'development'}.env`),
        },
        TypeormConfigService,
    ],
    exports: [ConfigService],
})
export class ConfigModule { }
