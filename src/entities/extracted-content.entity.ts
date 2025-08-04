import { Column, Entity, ManyToMany, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { ChatMessage } from "./chat-message.entity";
import { ChatSession } from "./chat-session.entity";

@Entity('extracted_contents')
export class ExtractedContent {
    @PrimaryGeneratedColumn()
    id: string;

    @ManyToMany(() => ChatMessage, (chatMessage) => chatMessage.extractedContents)
    chatMessages: ChatMessage[];

    @Column({ type: 'text', nullable: true })
    text: string;

    @Column({ type: 'text', nullable: true })
    fileId: string; // ID of the file from which this content was extracted

    @Column({ type: 'text', nullable: true })
    fileName: string; // Name of the file from which this content was extracted

    @Column({ type: 'text', nullable: true })
    userId: string; // ID of the user who extracted this content

    @Column({ type: 'text', nullable: true})
    sessionId: string;

    @ManyToOne(() => ChatSession, (chatSession) => chatSession.extractedContents)
    chatSession: ChatSession;
}