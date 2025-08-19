import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(2)
  country: string;
}

export class LoginDto {
  @IsString()
  email: string;

  @IsString()
  password: string;
}
