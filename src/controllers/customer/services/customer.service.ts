import { ResponseMessages } from './../../../utils/response-messages';
import { VerifyCustomerRequest } from './../../../models/request-dto/verify-customer-dto';
import { AppUtils } from './../../../utils/app-utils';
import { AppConstants } from './../../../utils/app-constants';
import { NotificationService } from './../../../core/notification.service';
import { Customer } from './../../../entities/customer.entity';
import { UserRepository } from './../../user/repository/user.repository';
import { CreateCustomerRequest } from './../../../models/request-dto/create-customer-request-dto';
import { BaseResponse } from './../../../models/response-dto/base-response';
import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, UnprocessableEntityException, InternalServerErrorException, HttpException, HttpStatus } from '@nestjs/common';
import { CustomerRepository } from '../repositories/customer-repository';
import { User } from '../../../entities/user.entity';
import * as bcrypt from "bcrypt";
import { v4 as uuidv4 } from 'uuid';
import { Request } from 'express';
import { EncryptedCode, EncryptionPurpose } from '../../../entities/encrypted-code.entity';
import { EncryptedCodeRepository } from '../../../controllers/user/repository/encrypted-code.repository';
import { getManager } from 'typeorm'

@Injectable()
export class CustomerService {
    constructor(
        @InjectRepository(CustomerRepository) private readonly _customerRepository: CustomerRepository,
        @InjectRepository(UserRepository) private readonly _userRepository: UserRepository,
        @InjectRepository(EncryptedCodeRepository) private readonly _encryptedCodeRepo: EncryptedCodeRepository,
        private readonly _notificationService: NotificationService
    ) { }

    async createCustomer(request: CreateCustomerRequest): Promise<BaseResponse> {
        let isExist = this._userRepository.hasUser(request.email);
        if (isExist) {
            throw new UnprocessableEntityException("Email has been taken");
        }
        // Generate otp and assign it to user
        let otp = AppUtils.GenerateOtp()
        let expiry = new Date();
        expiry.setHours(expiry.getHours() + 2);
        let encryptedCode = new EncryptedCode();
        encryptedCode.salt = await bcrypt.genSalt();
        encryptedCode.code = await bcrypt.hashPassword(otp, encryptedCode.salt);
        encryptedCode.expiry = expiry;
        encryptedCode.purpose = EncryptionPurpose.CUSTOMER_ONBOARDING;
        // this._encryptedCodeRepo.save(encryptedCode);

        let user = new User();
        user.email = request.email;
        user.isEmailConfirmed = false;
        user.isPhoneNumberConfirmed = false;
        user.isActive = false;
        user.phoneNumber = request.phoneNumber;
        user.securityStamp = await bcrypt.genSalt();
        user.password = await bcrypt.hashPassword(request.password, user.securityStamp);
        user.encryptedCode = encryptedCode;
        // this._userRepository.save(user);

        let customer = new Customer();
        customer.firstname = request.firstname;
        customer.lastname = request.lastname;
        customer.user = user;
        // this._customerRepository.save(customer);

        try {
            await getManager().transaction(async transactionalEntityManager => {
                await transactionalEntityManager.save(encryptedCode);
                await transactionalEntityManager.save(user);
                await transactionalEntityManager.save(customer);
                // ...
            });
        } catch (error) {
            console.log(`Error while creating customer: ${error}`);
        }

        //send activation link to email
        let from = AppConstants.ELASTIC_EMAIL_USERNAME;
        let to = user.email;
        let FromName = "Construmart";
        let subject = "Your Account Registration"
        let htmlbody = `<h4>Please use the one time password <b>${otp}</b> to activate your account</h4>`
        this._notificationService.sendEmail(from, to, FromName, subject, null, htmlbody)
            .catch(() => {
                console.error("Error occurred while sending mail upon customer signup");
                throw new InternalServerErrorException("Failed to send email");
            });
        return {
            status: true,
            message: 'Please complete your registration using the one time password sent to your email',
            body: null
        }
    }

    async verifyCustomer(request: VerifyCustomerRequest): Promise<BaseResponse> {
        //fetch user by email
        let user = await this._userRepository.findOne({ where: { email: request.email } });
        //fetch saved encrypted otp
        let savedEncryptedCode = await this._encryptedCodeRepo.findOne({ where: { user: user } });
        //encrypt incoming otp and compare encrypted
        let encryptedOtp = await bcrypt.hashPassword(request.otp, savedEncryptedCode.salt) as string;
        //compare otp
        if (String(encryptedOtp) === savedEncryptedCode.code) {
            //activate user
            user.isActive = true;
            user.isEmailConfirmed = true;
            try {
                var updatedUser = await this._userRepository.save(user);
            } catch (error) {
                throw new HttpException(ResponseMessages.ERROR, HttpStatus.NOT_MODIFIED);
            }
            //return response
            return {
                body: null,
                message: null,
                status: true
            }
        }
        return {
            body: null,
            message: 'Invalid OTP',
            status: false
        }
    }
}